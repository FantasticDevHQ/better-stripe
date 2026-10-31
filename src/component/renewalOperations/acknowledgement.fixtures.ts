import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import {
  getConvexSize,
  getDocumentSize,
  type Infer,
  type ObjectType,
} from "convex/values";
import type {
  appendArgs,
  eventReceipt,
  retainAcknowledgementArgs,
  retentionReceipt,
} from "./schema.js";
import { expect, vi } from "vitest";
import { modules, schema } from "../../test.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
  constructRenewalScheduleAttachmentReceiptV2,
  type ConstructRenewalScheduleAttachmentReceiptV2Options,
} from "../../client/billing/renewalV2/index.js";
import { receiptInput } from "../../client/billing/renewalAttach/internal/acquisition/test-fixtures/fixture.mjs";
import { admitInitialOutput } from "../../client/billing/renewalAttach/internal/recovery/material.js";
import {
  captureAttachSource,
  captureAttachDispatch,
  captureAttachResponse,
  captureAttachReceipt,
} from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import {
  eventDigest,
  objectNode,
  scalarNode,
  materialize,
} from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";
import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";

export type EventReceipt = Infer<typeof eventReceipt>;
export type RetainArgs = ObjectType<typeof retainAcknowledgementArgs>;
// Closed storage DATA only; inferred types cannot assert actual custody.
export type RetentionReceipt = Infer<typeof retentionReceipt>;

export const VALUE_LIMIT = 1048576;
const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
const bind = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:bindInitialBasis",
);
export const append = makeFunctionReference<
  "mutation",
  ObjectType<typeof appendArgs>,
  EventReceipt
>("renewalOperations/mutations:appendStageEvent");
export const retain = makeFunctionReference<
  "mutation",
  RetainArgs,
  RetentionReceipt | null
>("renewalOperations/mutations:retainProviderAcknowledgement");
export const canonical = (value: unknown) =>
  JSON.stringify(renewalSnapshot(value));

export const negativeScenarios = [
  "privacy-text",
  "privacy-key",
  "unsafe-integer",
  "ordinary-binding",
] as const;
type NegativeScenario = (typeof negativeScenarios)[number];
export type Scenario = "clean" | "nullable-key" | NegativeScenario;
const negativeMetadata: Record<
  NegativeScenario,
  Record<string, string | number>
> = {
  "privacy-text": { opaque: "Bearer synthetic-fixture" },
  "privacy-key": { client_secret: "synthetic-value" },
  "unsafe-integer": { unsafe: 9007199254740992 },
  "ordinary-binding": {
    ordinary:
      "renewal:v2:sha256:" + "a".repeat(25) + "1234567890123" + "a".repeat(26),
  },
};

export async function prepareAcknowledgementScenario(scenario: Scenario) {
  return prepareAcknowledgement(scenario, 1);
}
export async function prepareV2AcknowledgementScenario() {
  return prepareAcknowledgement("clean", 2);
}
async function prepareAcknowledgement(scenario: Scenario, mode: 1 | 2) {
  const shouldRetain = scenario === "clean" || scenario === "nullable-key";
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  // Offline source only. This is not an actual provider/Owner/C10 ACK fixture.
  // Complete raw recipe precedes every constructor and DB operation.
  const recipe = receiptInput();
  const declared =
    scenario === "clean"
      ? recipe
      : {
          ...recipe,
          providerSnapshot: {
            ...recipe.providerSnapshot,
            metadata: {
              ...recipe.providerSnapshot.metadata,
              ...(scenario === "nullable-key"
                ? { client_secret: null }
                : negativeMetadata[scenario]),
            },
          },
        };
  const declaredJSON = canonical(declared);
  const sourceJSON = canonical(declared.attachRequest);
  const bodyJSON = canonical(declared.providerSnapshot);
  const wire = declared.actualDispatch;
  assert(wire.scope === "platform");
  assert(wire.method === "POST");
  assert(wire.path === "/v1/subscription_schedules");
  const raw: ConstructRenewalScheduleAttachmentReceiptV2Options = {
    attachRequest: declared.attachRequest,
    actualDispatch: {
      scope: wire.scope,
      apiVersion: wire.apiVersion,
      method: wire.method,
      path: wire.path,
      payload: wire.payload,
      key: wire.key,
      firstDispatchedAt: wire.firstDispatchedAt,
    },
    providerSnapshot: declared.providerSnapshot,
  };
  const authorization = Object.freeze({
    scope: "ack01-offline-host",
    id: "ack01-original-consent",
    revision: 1,
  });
  const basis = Object.freeze({
    startWallMs: 1700000001000,
    startNs: "1700000001000000000",
    workEndWallMs: 1700000005000,
    workEndNs: "1700000005000000000",
    endWallMs: 1700000006000,
    endNs: "1700000006000000000",
  });
  // Independent V2 unsigned DATA; never relabel the legacy ns as an origin.
  const timingPolicy = Object.freeze({
    version: 1,
    firstDispatchedAt: 1700000001,
    periodStart: 1700000000,
    periodEnd: 1702592000,
    workEndWallMs: 1700000005000,
    endWallMs: 1700000006000,
  });
  const operationalBasis = Object.freeze({
    startWallMs: 1700000001000,
    startNsDecimal: "1000000000",
    workEndWallMs: 1700000005000,
    workEndNsDecimal: "5000000000",
    endWallMs: 1700000006000,
    endNsDecimal: "6000000000",
  });
  const responseStatus = 200;
  expect(canonical(raw)).toBe(declaredJSON);
  expect(Object.keys(declared.actualDispatch)).toHaveLength(7);
  // Existing runtime-neutral capture, then actual public pure constructors.
  captureAttachSource(raw.attachRequest);
  const prepared = await prepareRenewalPriceReplacementV2(
    raw.attachRequest.preparation,
  );
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: raw.attachRequest.apiVersion,
    attachKey: raw.attachRequest.attachKey,
    firstDispatchedAt: raw.attachRequest.firstDispatchedAt,
  });
  const seven = {
    scope: request.scope,
    apiVersion: request.apiVersion,
    method: request.method,
    path: request.path,
    payload: request.payload,
    key: request.key,
    firstDispatchedAt: request.firstDispatchedAt,
  };
  if (mode === 2) {
    expect(prepared.expected.periodStart).toBe(timingPolicy.periodStart);
    expect(prepared.expected.periodEnd).toBe(timingPolicy.periodEnd);
    expect(request.firstDispatchedAt).toBe(timingPolicy.firstDispatchedAt);
  }
  // Compare ENTIRE declared dispatch; no extra field is projected away.
  expect(declared.actualDispatch).toEqual(seven);
  expect(raw.actualDispatch).toEqual(declared.actualDispatch);
  const receipt = await constructRenewalScheduleAttachmentReceiptV2(raw);
  expect(receipt.stage).toBe("attached_unconfigured");
  expect(receipt.request).toEqual(request);
  expect(receipt.providerSnapshot).toEqual(declared.providerSnapshot);
  expect(receipt.binding).toMatch(
    /^renewal-attach-receipt:v2:sha256:[0-9a-f]{64}$/,
  );
  // TEST-only Node guard: no component/helper imports it in this proposal.
  // This is actual whole initial-output DATA admission, not a receipt-only cap.
  if (shouldRetain) {
    const output = admitInitialOutput(receipt, prepared, request);
    expect(output).toEqual({
      status: "attach_acknowledged",
      operationalAuthority: false,
      receipt,
    });
  } else {
    expect(() => admitInitialOutput(receipt, prepared, request)).toThrow(
      "REQUIRED_JSON_PRIVACY_STOP",
    );
  }
  expect(canonical(raw)).toBe(declaredJSON);
  if (scenario === "nullable-key") {
    expect(
      Object.prototype.hasOwnProperty.call(
        recipe.providerSnapshot.metadata,
        "client_secret",
      ),
    ).toBe(false);
    const field = Object.getOwnPropertyDescriptor(
      receipt.providerSnapshot.metadata,
      "client_secret",
    );
    assert(field && "value" in field);
    expect(field.value).toBeNull();
  }
  const receiptJSON = canonical(receipt);
  expect(receiptJSON.length).toBeLessThanOrEqual(500000);
  expect(new TextEncoder().encode(receiptJSON).length).toBeLessThanOrEqual(
    500000,
  );
  const commonRecord = {
    requestBinding: request.requestIdentity.binding,
    authorization,
    logicalOperationId: "ack01-original-operation",
    stage: "attach",
    account: { mode: "platform", stripeAccount: null, livemode: false },
    apiVersion: raw.attachRequest.apiVersion,
    profile: "unqualified-offline-C3-storage-DATA",
    attachRequest: raw.attachRequest,
    dispatch: declared.actualDispatch,
    originalBundle: raw.attachRequest.preparation,
  };
  const record =
    mode === 1
      ? { ...commonRecord, schemaVersion: 1, basis }
      : { ...commonRecord, schemaVersion: 2, timingPolicy };
  const recordJSON = canonical(record);
  expect(JSON.parse(recordJSON).attachRequest).toEqual(declared.attachRequest);
  const data = [
    { event: "dispatch", stage: "attach", request },
    {
      event: "response",
      stage: "attach",
      request,
      body: raw.providerSnapshot,
      status: responseStatus,
    },
  ];
  const captures = [captureAttachDispatch(data[0])];
  if (shouldRetain) captures.push(captureAttachResponse(data[1]));
  else expect(() => captureAttachResponse(data[1])).toThrow();
  const events: Awaited<ReturnType<typeof canonicalJournalEvent>>[] = [];
  for (const [index, datum] of data.entries()) {
    const node = captures[index];
    if (node) expect(materialize(node)).toEqual(datum);
    const event = await canonicalJournalEvent(
      index + 1,
      canonical(data[index]),
    );
    if (node) {
      expect(event.binding).toBe(
        await eventDigest(
          objectNode([
            ["sequence", scalarNode(index + 1)],
            ["data", node],
          ]),
        ),
      );
    } else {
      // Invalid host response DATA is only generic journal JSON, not a valid
      // typed C10 capture. Actual append rechecks the complete canonical hash.
      expect(event.json).toBe(canonical(datum));
      expect(event.binding).toMatch(
        /^unbound-qualification-event:v2:sha256:[0-9a-f]{64}$/,
      );
    }
    events.push(event);
  }
  // The clean small fixture admits event3; invalid host DATA must fail capture.
  const receiptEvent = { event: "receipt", stage: "attach", request, receipt };
  if (shouldRetain) captureAttachReceipt(receiptEvent);
  else expect(() => captureAttachReceipt(receiptEvent)).toThrow();
  const t = convexTest(schema, modules);
  const physical = async () => ({
    operations: await t.run((ctx) => ctx.db.query("renewalOperations").take(3)),
    attempts: await t.run((ctx) =>
      ctx.db.query("renewalOperationAttempts").take(3),
    ),
    events: await t.run((ctx) =>
      ctx.db.query("renewalOperationEvents").take(4),
    ),
    payloads: await t.run((ctx) =>
      ctx.db.query("renewalOperationPayloads").take(6),
    ),
  });
  const creationArgs = {
    authorizationScope: authorization.scope,
    authorizationRevision: authorization.revision,
    logicalOperationId: record.logicalOperationId,
    recordJSON,
  };
  expect(getConvexSize(creationArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const created = await t.mutation(create, creationArgs);
  expect(created.status).toBe("created");
  expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
  const queryArgs = { operationId: created.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const original = await t.query(load, queryArgs);
  expect(original).toEqual({
    ...queryArgs,
    recordJSON,
    revision: 0,
    activeAttempt: null,
    ...(mode === 2 ? { recordVersion: 2, initialBasis: null } : {}),
  });
  expect(getConvexSize(original)).toBeLessThanOrEqual(VALUE_LIMIT);
  const reserveArgs = {
    ...queryArgs,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: record.requestBinding,
    recordJSON,
  };
  expect(getConvexSize(reserveArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  expect(acquired.reservation.recordJSON).toBe(recordJSON);
  if (mode === 1) expect(acquired.reservation.basisJSON).toBe(canonical(basis));
  else {
    const summary = {
      recordVersion: 2,
      operationId: created.operationId,
      payloadId: acquired.reservation.payloadId,
      authorizationScope: authorization.scope,
      authorizationId: authorization.id,
      authorizationRevision: authorization.revision,
      logicalOperationId: record.logicalOperationId,
      requestBinding: record.requestBinding,
      stage: "attach",
      key: request.key,
      apiVersion: request.apiVersion,
      accountJSON: canonical(record.account),
      timingPolicyJSON: canonical(timingPolicy),
      firstDispatchedAt: request.firstDispatchedAt,
      ordinal: 1,
      preparedRevision: 0,
      committedRevision: 1,
      attemptId: acquired.reservation.attemptId,
    };
    expect(acquired).toEqual({
      disposition: "acquired",
      previousRevision: 0,
      committedRevision: 1,
      reservation: { ...summary, recordJSON },
    });
    expect(
      Object.prototype.hasOwnProperty.call(acquired.reservation, "basisJSON"),
    ).toBe(false);
    const bindArgs = {
      operationId: created.operationId,
      attemptId: acquired.reservation.attemptId,
      policyJSON: canonical(timingPolicy),
      basisJSON: canonical(operationalBasis),
    };
    expect(getConvexSize(bindArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const initialBasis = {
      version: 1,
      attemptId: acquired.reservation.attemptId,
      sourcePayloadId: acquired.reservation.payloadId,
      stage: "attach",
      policyJSON: bindArgs.policyJSON,
      basisJSON: bindArgs.basisJSON,
    };
    const bound = await t.mutation(bind, bindArgs);
    expect(bound).toEqual({ status: "bound", ...queryArgs, initialBasis });
    expect(getConvexSize(bound)).toBeLessThanOrEqual(VALUE_LIMIT);
    const loaded = await t.query(load, queryArgs);
    expect(loaded).toEqual({
      recordVersion: 2,
      ...queryArgs,
      recordJSON,
      revision: 1,
      activeAttempt: summary,
      initialBasis,
    });
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
  const ownerScope = {
    operationId: created.operationId,
    attemptId: acquired.reservation.attemptId,
    stage: acquired.reservation.stage,
  };
  const commits: EventReceipt[] = [];
  for (const [index, event] of events.entries()) {
    const args: ObjectType<typeof appendArgs> = {
      reservation: acquired.reservation,
      expectedSequence: index,
      event: {
        sequence: event.sequence,
        binding: event.binding,
        dataJSON: event.json,
      },
    };
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    const committed = await t.mutation(append, args);
    expect(committed.sequence).toBe(index + 1);
    expect(committed.binding).toBe(event.binding);
    expect(committed.reservation).toEqual(acquired.reservation);
    expect(committed.operationId).toBe(created.operationId);
    expect(committed.attemptId).toBe(acquired.reservation.attemptId);
    expect(committed.sourcePayloadId).toBe(acquired.reservation.payloadId);
    expect(committed.stage).toBe("attach");
    expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
    commits.push(committed);
  }
  const before = await physical();
  expect(Object.values(before).map((rows) => rows.length)).toEqual([
    1, 1, 2, 3,
  ]);
  expect(before.attempts[0].lastSequence).toBe(2);
  expect(before.operations[0].revision).toBe(1);
  for (const [index, committed] of commits.entries()) {
    const eventRow = before.events.find((row) => row._id === committed.eventId);
    const payloadRow = before.payloads.find(
      (row) => row._id === committed.payloadId,
    );
    assert(eventRow && payloadRow);
    expect(Number.isFinite(eventRow._creationTime)).toBe(true);
    expect(eventRow).toEqual({
      _id: committed.eventId,
      _creationTime: eventRow._creationTime,
      operationId: committed.operationId,
      attemptId: committed.attemptId,
      stage: committed.stage,
      sourcePayloadId: committed.sourcePayloadId,
      sequence: committed.sequence,
      binding: committed.binding,
      payloadId: committed.payloadId,
    });
    expect(Number.isFinite(payloadRow._creationTime)).toBe(true);
    expect(payloadRow).toEqual({
      _id: committed.payloadId,
      _creationTime: payloadRow._creationTime,
      codecVersion: 1,
      json: events[index].json,
      owner: {
        kind: "event",
        ...ownerScope,
        sequence: committed.sequence,
      },
    });
    expect(JSON.parse(payloadRow.json)).toEqual(data[index]);
  }
  expect(
    Object.prototype.hasOwnProperty.call(
      before.operations[0],
      "knownAcknowledgement",
    ),
  ).toBe(false);
  const sourcePayload = before.payloads.find(
    (row) => row._id === acquired.reservation.payloadId,
  );
  const responsePayload = before.payloads.find(
    (row) => row._id === commits[1].payloadId,
  );
  assert(sourcePayload && responsePayload);
  expect(sourcePayload.json).toBe(recordJSON);
  expect(sourcePayload.owner).toEqual({
    kind: "operation",
    operationId: created.operationId,
  });
  expect(canonical(JSON.parse(sourcePayload.json).attachRequest)).toBe(
    sourceJSON,
  );
  expect(canonical(JSON.parse(responsePayload.json).body)).toBe(bodyJSON);
  expect(
    Object.getOwnPropertyDescriptor(receipt.providerSnapshot, "__proto__")
      ?.value,
  ).toEqual({ retained: true, nested: ["SYNTHETIC", null] });
  expect(receipt.providerSnapshot.future_native_field).toEqual({
    retained: [null, "safe", 1.25],
  });
  for (const rows of Object.values(before))
    for (const doc of rows)
      expect(getDocumentSize(doc)).toBeLessThanOrEqual(VALUE_LIMIT);
  const args: RetainArgs = {
    ...queryArgs,
    attemptId: acquired.reservation.attemptId,
    expectedSequence: 2,
    receiptJSON,
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(fetchCalls).toBe(0);
  console.info(
    "BTS317_ACK01_PREREQUISITES",
    JSON.stringify({
      recordBytes: new TextEncoder().encode(recordJSON).length,
      receiptBytes: new TextEncoder().encode(receiptJSON).length,
      wholeRPCBytes: getConvexSize(args),
      counts: [1, 1, 2, 3],
      lastSequence: 2,
      fullNodeOutputAdmitted: shouldRetain,
      scenario,
      fetchCalls,
    }),
  );
  return {
    t,
    physical,
    before,
    args,
    receipt,
    receiptJSON,
    acquired,
    commits,
    ownerScope,
    queryArgs,
    shouldRetain,
    scenario,
    raw,
    prepared,
    request,
    receiptEvent,
    fetchCalls: () => fetchCalls,
  };
}
