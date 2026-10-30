import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { data, deepFreeze } from "./configurePreflightControls.js";
import { assertFit } from "./configurePreflightAssertions.js";
import type { declareConfigureWriteCase } from "./configureWriteDeclarations.js";
import type { WriteObservations } from "./configureWriteObservations.js";
import { assertActualWriteCounters } from "./configureWriteObservations.js";
import type { configureWriteBarriers } from "./configureWriteBarriers.js";
import type { ConfigureWriteFixture } from "./configureWriteOperation.js";
import type { ProjectedRenewalConfigurationV2 } from "../../../renewalV2/index.js";

/** Independent form oracle: compare every encoded leaf, including numeric array positions. */
function formLeaves(value: unknown, path = ""): [string, string][] {
  if (value === null) return [[path, ""]];
  if (typeof value !== "object") return [[path, String(value)]];
  return Object.entries(value).flatMap(([key, child]) =>
    formLeaves(child, path ? path + "[" + key + "]" : key),
  );
}
export function createWriteHTTPAndSink(
  declared: ReturnType<typeof declareConfigureWriteCase>,
  s: WriteObservations,
  gates: ReturnType<typeof configureWriteBarriers>,
  request: ProjectedRenewalConfigurationV2,
  owner: typeof import("../originalOwner.js").OWNER,
  advanceSchedule: () => void,
) {
  const b = declared.currentBundle;
  const query = new URLSearchParams(
    ["discounts", "items.data.discounts", "items.data.price"].map((v, i) => [
      "expand[" + i + "]",
      v,
    ]),
  );
  const rows = deepFreeze([
    {
      method: "GET",
      path:
        "/v1/subscriptions/" +
        encodeURIComponent(b.wireSubscription.id) +
        "?" +
        query,
      body: b.wireSubscription,
    },
    {
      method: "GET",
      path: "/v1/prices/" + encodeURIComponent(b.wireTargetPrice.id),
      body: b.wireTargetPrice,
    },
    {
      method: "GET",
      path: "/v1/customers/" + encodeURIComponent(b.wireBillingCustomer.id),
      body: b.wireBillingCustomer,
    },
    ...b.couponReads.map((row) => ({
      method: "GET",
      path: "/v1/coupons/" + encodeURIComponent(row.couponId),
      body: row.wireCoupon,
    })),
    { method: "GET", path: request.path, body: declared.currentSchedule },
    { method: "POST", path: request.path, body: declared.response },
  ]);
  const fetch = async (input: unknown, init: RequestInit) => {
    const row = rows[s.calls.length],
      url = new URL(String(input));
    assert(row, "UNDECLARED_CONFIGURE_WRITE_HTTP");
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(url.pathname + url.search, row.path);
    assert.equal(init.method, row.method);
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("stripe-version"), request.apiVersion);
    assert.equal(headers.get("stripe-account"), null);
    if (row.method === "POST") {
      assert.equal(headers.get("idempotency-key"), request.key);
      const received = [
        ...new URLSearchParams(String(init.body)).entries(),
      ].sort();
      assert.deepEqual(received, formLeaves(request.payload).sort());
      assert.equal(s.records.length, 1, "POST_REQUIRES_DISPATCH_SEND_AND_ACK");
    }
    s.calls.push({
      method: row.method,
      path: row.path,
      body: init.body ?? null,
      key: headers.get("idempotency-key"),
    });
    s.trace.push("http:" + row.method);
    if (
      (declared.name === "get-reject" && row.method === "GET") ||
      (declared.name === "post-reject" && row.method === "POST")
    )
      throw declared.providerRejection;
    if (declared.name === "retire-get" && row.method === "GET")
      await gates.hold("get");
    if (
      (declared.name === "retire-post" || declared.name === "pending-prior") &&
      row.method === "POST"
    )
      await gates.hold("post");
    if (row.method === "GET" && row.path === request.path) advanceSchedule();
    const status = row.method === "POST" ? declared.status : 200;
    return new Response(
      JSON.stringify(status >= 400 ? declared.errorBody : row.body),
      {
        status,
        headers: {
          "content-type": "application/json",
          ...(declared.requestId === null
            ? {}
            : { "request-id": declared.requestId }),
          ...(status === 307 || status === 308
            ? { location: "https://api.stripe.com/v1/forbidden-retry" }
            : {}),
        },
      },
    );
  };
  const sink = Object.freeze({
    send(value: unknown, acknowledge: (value: unknown) => void) {
      owner.check();
      const record = data(value),
        sequence = record.sequence;
      assert.equal(sequence, s.records.length + 1);
      assertFit(record);
      s.records.push(record);
      s.trace.push("sink:" + String(sequence));
      const ack = { sequence, binding: record.binding };
      if (declared.name === "wrong-ack") {
        acknowledge({ ...ack, binding: "wrong" });
        return;
      }
      if (declared.name === "duplicate-ack") {
        acknowledge(ack);
        acknowledge(ack);
        return;
      }
      const stage =
        sequence === 1 ? "dispatch" : sequence === 2 ? "response" : "receipt";
      if (declared.name === stage + "-ack") {
        const task = gates.hold(stage + "-ack").then(() => {
          acknowledge(ack);
          s.trace.push("ack:" + String(sequence));
        });
        gates.pending.push(task);
        return;
      }
      acknowledge(ack);
      s.trace.push("ack:" + String(sequence));
      if (declared.name === stage + "-send") return gates.hold(stage + "-send");
      if (declared.name === "retire-" + stage) return gates.hold(stage);
    },
  });
  return Object.freeze({ fetch, sink });
}

const requestSlots = [
  ["logicalBinding"],
  ["attachReceiptBinding"],
  ["baselineBinding"],
  ["defaultSettingsBinding"],
  ["requestIdentity", "binding"],
] as const;
export function ackSlots(h: ConfigureWriteFixture) {
  const record = [
    ...requestSlots.map((path) => ["originalRecord", "request", ...path]),
    ["originalRecord", "attachReceipt", "logicalBinding"],
    ["originalRecord", "attachReceipt", "request", "logicalBinding"],
    [
      "originalRecord",
      "attachReceipt",
      "request",
      "requestIdentity",
      "binding",
    ],
    ["originalRecord", "attachReceipt", "binding"],
  ];
  return [
    ...record,
    ["receipt", "logicalBinding"],
    ...requestSlots.map((path) => ["receipt", "request", ...path]),
    ["receipt", "attachReceiptBinding"],
    ["receipt", "providerSnapshotBinding"],
    ["receipt", "binding"],
    ...(Object.prototype.hasOwnProperty.call(
      h.expectedReceipt,
      "defaultSettingsBinding",
    )
      ? [["receipt", "defaultSettingsBinding"]]
      : []),
  ];
}
export function assertConfigureACK(h: ConfigureWriteFixture, output: unknown) {
  assert.deepEqual(output, h.expectedACK);
  const out = data(output);
  assert.deepEqual(Object.keys(out).sort(), [
    "operationalAuthority",
    "originalRecord",
    "rawReceipt",
    "receipt",
    "status",
  ]);
  assert(Object.isFrozen(out));
  assert.equal(out.operationalAuthority, false);
  assert.deepEqual(data(out.receipt).providerSnapshot, h.write.response);
  assert.deepEqual(data(out.receipt).request, h.projected);
  const slots = ackSlots(h);
  assert.equal(
    slots.length,
    h.write.name === "defaults-null" ||
      h.write.name === "defaults-object" ||
      h.write.name === "configured-history" ||
      h.write.name === "configured-history-onephase" ||
      h.write.name === "configured-history-drift"
      ? 19
      : 18,
  );
  for (const path of slots) {
    let actual: unknown = output,
      expected: unknown = h.expectedACK;
    for (const key of path) {
      actual = data(actual)[key];
      expected = data(expected)[key];
    }
    assert.equal(actual, expected);
  }
  assertActualWriteCounters(h.writeState);
  assert.equal(
    h.writeState.calls.length,
    5 + h.write.currentBundle.couponReads.length,
  );
  assert(h.writeState.calls.filter((row) => row.method === "GET").length <= 44);
  for (const [part, value] of [
    ["record", h.expectedRecord],
    ["rawReceipt", h.rawReceipt],
    ["receipt", h.expectedReceipt],
    ["ACK", output],
  ] as const)
    console.log(
      JSON.stringify({
        kind: "CONFIGURE_WRITER_WHOLE_METRICS",
        part,
        ...assertFit(value),
      }),
    );
}

export function assertProviderFailure(
  h: ConfigureWriteFixture,
  error: unknown,
  phase: "read" | "post",
) {
  assert(error instanceof Error);
  assert.equal(error.message, "OWNED_CONFIGURE_PROVIDER_REJECTED");
  const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
  assert(descriptor && "value" in descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.writable, false);
  const failure = data(descriptor.value);
  assert.deepEqual(Object.keys(failure).sort(), [
    "category",
    "diagnostics",
    "operationalAuthority",
    "ordinal",
    "outcome",
    "phase",
    "request",
    "resource",
  ]);
  assert.equal(failure.category, "provider_rejected");
  assert.equal(failure.phase, phase);
  assert.equal(
    failure.resource,
    phase === "read" ? "subscription" : "configure",
  );
  assert.equal(
    failure.ordinal,
    phase === "read" ? 1 : 5 + h.write.currentBundle.couponReads.length,
  );
  const diagnostics = data(failure.diagnostics);
  assert(Object.isFrozen(diagnostics));
  assert(
    Object.keys(diagnostics).every((key) =>
      ["type", "code", "requestId", "statusCode"].includes(key),
    ),
  );
  for (const value of Object.values(diagnostics))
    if (typeof value === "string") {
      assert(value.length > 0 && value.length <= 255);
      assert(!value.includes("sk_live_"));
    }

  assert.equal(failure.outcome, "unknown");
  assert.equal(failure.operationalAuthority, false);
  assert.deepEqual(failure.request, h.projected);
  assert(Object.isFrozen(failure));
  assertFit(failure);
  assert.equal(Object.prototype.hasOwnProperty.call(error, "cause"), false);
}

/** Actual unchanged C9 and all whole DATA metrics must qualify before the target. */
export async function establishWriteOracle(
  active: typeof import("../../../renewalV2/index.js"),
  owner: typeof import("../originalOwner.js").OWNER,
  configuration: Parameters<typeof active.projectRenewalConfigurationV2>[0],
  projected: ProjectedRenewalConfigurationV2,
  write: ReturnType<typeof declareConfigureWriteCase>,
  expectedRecord: unknown,
) {
  const dispatch = {
    scope: projected.scope,
    apiVersion: projected.apiVersion,
    method: projected.method,
    path: projected.path,
    payload: projected.payload,
    key: projected.key,
    firstDispatchedAt: projected.firstDispatchedAt,
  };
  const rawReceipt = deepFreeze({
    configuration: configuration,
    actualDispatch: dispatch,
    providerSnapshot: write.oracleResponse,
    transport: {
      status: 200,
      ...(write.oracleRequestId === null
        ? {}
        : { requestId: write.oracleRequestId }),
    },
  });
  const expectedReceipt =
    await active.constructRenewalConfigurationReceiptV2(rawReceipt);
  owner.check();
  assert.equal(
    expectedReceipt.stage,
    "configure_acknowledged",
    "ACTUAL_C9_PREREQUISITE",
  );
  assertFit(rawReceipt);
  assertFit(expectedReceipt);
  const expectedACK = deepFreeze({
    status: "configure_acknowledged",
    originalRecord: expectedRecord,
    rawReceipt,
    receipt: expectedReceipt,
    operationalAuthority: false,
  });
  assertFit(expectedACK);
  return { rawReceipt, expectedReceipt, expectedACK };
}

/** Independent Node hash oracle uses the documented exact V2 JSON preimage. */
function expectedBinding(family: string, preimage: unknown) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : value;
  const text = JSON.stringify(
    canonical(["betterstripe-renewal-binding", 2, family, preimage]),
  );
  assert(Buffer.byteLength(text, "utf8") <= 500000);
  return (
    family +
    ":v2:sha256:" +
    createHash("sha256").update(text, "utf8").digest("hex")
  );
}
export function assertWriteTokenPreimages(
  preparedValue: unknown,
  recordValue: unknown,
  receiptValue: unknown,
) {
  const prepared = data(preparedValue),
    record = data(recordValue),
    request = data(record.request),
    attach = data(record.attachReceipt),
    receipt = data(receiptValue);
  const {
    status: _status,
    preservation: _preservation,
    requestIdentity: _identity,
    ...C1
  } = prepared;
  const logical = expectedBinding("renewal", C1);
  assert.equal(request.logicalBinding, logical);
  assert.equal(attach.logicalBinding, logical);
  const attachRequest = data(attach.request),
    { requestIdentity: attachIdentity, ...C2 } = attachRequest;
  assert.equal(attachRequest.logicalBinding, logical);
  assert.equal(
    data(attachIdentity).binding,
    expectedBinding("renewal-attach", C2),
  );
  const { binding: attachBinding, ...C3 } = attach;
  assert.equal(attachBinding, expectedBinding("renewal-attach-receipt", C3));
  assert.equal(request.attachReceiptBinding, attachBinding);
  assert.equal(
    request.baselineBinding,
    expectedBinding("renewal-baseline", attach.providerSnapshot),
  );
  const configuration = data(record.configuration),
    schedule = data(configuration.schedule);
  assert.equal(
    request.defaultSettingsBinding,
    expectedBinding("renewal-defaults", schedule.default_settings),
  );
  const {
    status: _s,
    providerQualification: _q,
    profile: _p,
    requestIdentity,
    ...C6
  } = request;
  assert.equal(Object.keys(C6).length, 14);
  assert.equal(
    data(requestIdentity).binding,
    expectedBinding("renewal-configure", C6),
  );
  assert.deepEqual(receipt.request, request);
  assert.equal(receipt.logicalBinding, logical);
  assert.equal(receipt.attachReceiptBinding, attachBinding);
  assert.equal(
    receipt.providerSnapshotBinding,
    expectedBinding("renewal-configured-baseline", receipt.providerSnapshot),
  );
  const response = data(receipt.providerSnapshot);
  assert.equal(
    Object.prototype.hasOwnProperty.call(receipt, "defaultSettingsBinding"),
    Object.prototype.hasOwnProperty.call(response, "default_settings"),
  );
  if (Object.prototype.hasOwnProperty.call(response, "default_settings"))
    assert.equal(
      receipt.defaultSettingsBinding,
      expectedBinding("renewal-configured-defaults", response.default_settings),
    );
  const { binding, ...C9 } = receipt;
  assert.equal(binding, expectedBinding("renewal-configure-receipt", C9));
}

export function logWritePrerequisites(values: {
  initialOutput: unknown;
  preflightOutput: unknown;
  expectedRecord: unknown;
  rawReceipt: unknown;
  expectedReceipt: unknown;
  expectedACK: unknown;
  request: ProjectedRenewalConfigurationV2;
  state: WriteObservations;
}) {
  const { request, state } = values;
  assert.equal(Object.keys(request).length, 18);
  assert.equal(data(values.initialOutput).status, "attach_acknowledged");
  assert.equal(
    data(values.preflightOutput).status,
    "configure_preflight_consistent",
  );
  assert.equal(data(values.expectedReceipt).stage, "configure_acknowledged");
  assert.deepEqual(
    [
      state.calls.length,
      state.records.length,
      state.sourceLoads,
      state.pairLoads,
      state.reserves,
      state.coverage,
      state.targetCalls,
    ],
    [0, 0, 0, 0, 0, 0, 0],
  );
  const raw = data(values.rawReceipt);
  const events = [
    { event: "dispatch", stage: "configure", request },
    {
      event: "response",
      stage: "configure",
      request,
      body: raw.providerSnapshot,
      transport: raw.transport,
    },
    {
      event: "receipt",
      stage: "configure",
      request,
      receipt: values.expectedReceipt,
    },
  ];
  for (const [index, event] of events.entries()) {
    const envelope = { sequence: index + 1, data: event };
    const template = {
      ...envelope,
      binding: expectedBinding("unbound-qualification-event", envelope),
    };
    console.log(
      JSON.stringify({
        kind: "CONFIGURE_WRITER_PREREQUISITE_METRICS",
        part: "C10-DATA-template-" + String(index + 1),
        ...assertFit(template),
      }),
    );
  }
  for (const [part, value] of Object.entries(values))
    if (!["request", "state"].includes(part))
      console.log(
        JSON.stringify({
          kind: "CONFIGURE_WRITER_PREREQUISITE_METRICS",
          part,
          ...assertFit(value),
        }),
      );
  console.log(
    JSON.stringify({
      kind: "CONFIGURE_WRITER_PREREQUISITES",
      actualInitialACK: true,
      actualOwnedPreflight: true,
      actualDirectC9: true,
      requestFields: 18,
      generatedACKSlots: Object.prototype.hasOwnProperty.call(
        values.expectedReceipt,
        "defaultSettingsBinding",
      )
        ? 19
        : 18,
      preimageOracle: "independent-Node-C1-through-C9",
      writeHTTP: 0,
      writeRecords: 0,
      targetCalls: 0,
      C10TemplatesAreActualSinkEvidence: false,
      operationalAuthority: false,
    }),
  );
}
