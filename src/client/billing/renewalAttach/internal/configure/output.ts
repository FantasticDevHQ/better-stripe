import { rejectProxyJSON } from "../acquisition/rawWireSource.js";
import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import {
  objectNode,
  scalarNode,
  encode,
  materialize,
  freeze,
  type Node,
  closed,
} from "../material/nodeKernel.js";
import { equal } from "../../../renewalAggregate/shared.js";
import { assertRequest, need, stop, seven } from "./request.js";
import { expectedSlots } from "../preflight/relations.js";
import { recordFamilies } from "../preflight/grammar.js";
import type { PreflightRecord } from "../preflight/grammar.js";
import type {
  ProjectedRenewalConfigurationV2,
  RenewalConfigurationReceiptV2,
  ConstructRenewalConfigurationReceiptV2Options,
} from "../../../renewalV2/index.js";
import type { Diagnostics } from "../operations/providerFailure.js";

const requestFamilies = Object.fromEntries(
  Object.entries(recordFamilies)
    .filter(([key]) => key.startsWith("/request/"))
    .map(([key, family]) => [key.slice(8), family]),
);
const has = (x: object, key: string) =>
  Object.prototype.hasOwnProperty.call(x, key);
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
/** Private full DATA walker. Only the fixed lexical entry points choose these tables. */
function capture(
  raw: unknown,
  families: Readonly<Record<string, string>>,
  expected?: Readonly<Record<string, string>>,
) {
  const active = new Set<object>(),
    found = new Set<string>();
  let count = 0;
  function walk(x: unknown, path: string, depth: number): Node {
    need(++count <= 10000 && depth <= 40 && !types.isProxy(x));
    if (has(families, path)) {
      need(
        typeof x === "string" &&
          new RegExp("^" + families[path] + ":v2:sha256:[0-9a-f]{64}$").test(x),
      );
      if (expected) need(x === expected[path]);
      found.add(path);
      return scalarNode(x);
    }
    if (x === null || typeof x !== "object") {
      requiredJSONSnapshot(x);
      return scalarNode(x);
    }
    need(!active.has(x));
    active.add(x);
    const array = Array.isArray(x),
      proto = Object.getPrototypeOf(x);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(x);
    need(keys.length <= 10001);
    const length = array ? Object.getOwnPropertyDescriptor(x, "length") : null,
      n: unknown = length?.value;
    if (array)
      need(
        length &&
          "value" in length &&
          typeof n === "number" &&
          Number.isSafeInteger(n) &&
          n >= 0 &&
          n <= 10000,
      );
    const entries: [string, Node][] = [];
    for (const key of keys) {
      need(typeof key === "string");
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && d.enumerable && "value" in d);
      requiredJSONSnapshot(key);
      requiredJSONSnapshot({ [key]: d.value === null ? null : true });
      need(
        !array ||
          (/^(0|[1-9][0-9]*)$/.test(key) &&
            typeof n === "number" &&
            Number(key) < n),
      );
      entries.push([key, walk(d.value, path + "/" + pointer(key), depth + 1)]);
    }
    active.delete(x);
    if (array) {
      need(entries.length === n);
      entries.sort(([a], [b]) => Number(a) - Number(b));
      return Object.freeze({
        kind: "array" as const,
        entries: Object.freeze(entries.map((e) => Object.freeze(e))),
      });
    }
    return objectNode(entries);
  }
  const node = walk(raw, "", 0);
  need(found.size === Object.keys(families).length);
  encode(node);
  return freeze(materialize(node));
}
function requestExpected(r: ProjectedRenewalConfigurationV2) {
  return {
    "/logicalBinding": r.logicalBinding,
    "/attachReceiptBinding": r.attachReceiptBinding,
    "/baselineBinding": r.baselineBinding,
    "/defaultSettingsBinding": r.defaultSettingsBinding,
    "/requestIdentity/binding": r.requestIdentity.binding,
  };
}
export function captureConfigureRequest(
  raw: unknown,
): ProjectedRenewalConfigurationV2 {
  try {
    const value = capture(raw, requestFamilies);
    assertRequest(value);
    return value;
  } catch {
    return stop();
  }
}
function failure(
  phase: "read" | "post",
  resource: string,
  ordinal: number,
  request: ProjectedRenewalConfigurationV2,
  diagnostics: Diagnostics,
) {
  rejectProxyJSON(request);
  rejectProxyJSON(diagnostics);
  assertRequest(request);
  need(
    (phase === "read" &&
      ["subscription", "price", "customer", "coupon", "schedule"].includes(
        resource,
      )) ||
      (phase === "post" && resource === "configure"),
  );
  need(
    Number.isSafeInteger(ordinal) &&
      ordinal >= 1 &&
      ordinal <= (phase === "read" ? 44 : 45),
  );
  need(!types.isProxy(diagnostics));
  const d = closed(
    diagnostics,
    [],
    ["type", "code", "statusCode", "requestId"],
  );
  for (const [key, value] of Object.entries(d))
    need(
      key === "statusCode"
        ? typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 100 &&
            value <= 599
        : typeof value === "string" && value.length >= 1 && value.length <= 255,
    );
  const families = Object.fromEntries(
    Object.entries(requestFamilies).map(([k, v]) => ["/request" + k, v]),
  );
  const expected = Object.fromEntries(
    Object.entries(requestExpected(request)).map(([k, v]) => [
      "/request" + k,
      v,
    ]),
  );
  return capture(
    {
      category: "provider_rejected",
      phase,
      resource,
      ordinal,
      request,
      diagnostics,
      outcome: "unknown",
      operationalAuthority: false,
    },
    families,
    expected,
  );
}
function ack(
  originalRecord: PreflightRecord,
  rawReceipt: ConstructRenewalConfigurationReceiptV2Options,
  actualReceipt: RenewalConfigurationReceiptV2,
) {
  rejectProxyJSON(originalRecord);
  rejectProxyJSON(rawReceipt);
  rejectProxyJSON(actualReceipt);
  need(
    !types.isProxy(originalRecord) &&
      !types.isProxy(rawReceipt) &&
      !types.isProxy(actualReceipt),
  );
  closed(originalRecord, [
    "configuration",
    "request",
    "attachReceipt",
    "originalBundle",
  ]);
  closed(rawReceipt, [
    "configuration",
    "actualDispatch",
    "providerSnapshot",
    "transport",
  ]);
  closed(rawReceipt.actualDispatch, [
    "scope",
    "apiVersion",
    "method",
    "path",
    "payload",
    "key",
    "firstDispatchedAt",
  ]);
  assertRequest(originalRecord.request);
  const r = actualReceipt;
  closed(
    r,
    [
      "version",
      "stage",
      "scope",
      "verification",
      "apiVersion",
      "logicalBinding",
      "request",
      "attachReceiptBinding",
      "scheduleId",
      "subscriptionId",
      "customerAccountId",
      "billingCustomerId",
      "livemode",
      "providerSnapshot",
      "transport",
      "providerSnapshotBinding",
      "binding",
    ],
    ["defaultSettingsBinding"],
  );
  need(
    r.version === 2 &&
      r.stage === "configure_acknowledged" &&
      r.scope === "platform" &&
      r.verification === "owned_response_only",
  );
  need(
    equal(rawReceipt.configuration, originalRecord.configuration) &&
      equal(rawReceipt.actualDispatch, seven(originalRecord.request)) &&
      equal(r.request, originalRecord.request) &&
      equal(rawReceipt.providerSnapshot, r.providerSnapshot) &&
      equal(rawReceipt.transport, r.transport),
  );
  need(
    r.apiVersion === originalRecord.request.apiVersion &&
      r.scheduleId === originalRecord.request.scheduleId &&
      r.scheduleId === originalRecord.attachReceipt.scheduleId &&
      r.subscriptionId === originalRecord.attachReceipt.subscriptionId &&
      r.customerAccountId === originalRecord.attachReceipt.customerAccountId &&
      r.livemode === originalRecord.attachReceipt.livemode &&
      r.billingCustomerId ===
        originalRecord.originalBundle.wireBillingCustomer.id,
  );
  need(
    originalRecord.request.attachReceiptBinding ===
      originalRecord.attachReceipt.binding &&
      originalRecord.attachReceipt.logicalBinding ===
        originalRecord.request.logicalBinding &&
      originalRecord.attachReceipt.request.logicalBinding ===
        originalRecord.request.logicalBinding,
  );
  requiredJSONSnapshot(rawReceipt);
  const t = closed(rawReceipt.transport, ["status"], ["requestId"]);
  need(
    typeof t.status === "number" &&
      Number.isInteger(t.status) &&
      t.status >= 200 &&
      t.status < 300,
  );
  if (has(t, "requestId"))
    need(
      typeof t.requestId === "string" &&
        t.requestId.length >= 1 &&
        t.requestId.length <= 255,
    );
  const present = has(rawReceipt.providerSnapshot, "default_settings");
  need(has(r, "defaultSettingsBinding") === present);
  const families: Record<string, string> = Object.fromEntries(
    Object.entries(recordFamilies).map(([k, v]) => ["/originalRecord" + k, v]),
  );
  const expected: Record<string, string> = Object.fromEntries(
    Object.entries(
      expectedSlots(
        originalRecord.request,
        originalRecord.attachReceipt,
        false,
      ),
    ).map(([k, v]) => ["/originalRecord" + k, v]),
  );
  for (const [k, family] of Object.entries(requestFamilies)) {
    families["/receipt/request" + k] = family;
    expected["/receipt/request" + k] = requestExpected(originalRecord.request)[
      k as keyof ReturnType<typeof requestExpected>
    ];
  }
  for (const [key, family, value] of [
    ["logicalBinding", "renewal", originalRecord.request.logicalBinding],
    [
      "attachReceiptBinding",
      "renewal-attach-receipt",
      originalRecord.attachReceipt.binding,
    ],
    [
      "providerSnapshotBinding",
      "renewal-configured-baseline",
      r.providerSnapshotBinding,
    ],
    ["binding", "renewal-configure-receipt", r.binding],
  ]) {
    families["/receipt/" + key] = family;
    expected["/receipt/" + key] = value;
  }
  if (present) {
    need(typeof r.defaultSettingsBinding === "string");
    families["/receipt/defaultSettingsBinding"] = "renewal-configured-defaults";
    expected["/receipt/defaultSettingsBinding"] = r.defaultSettingsBinding;
  }
  need(Object.keys(families).length === (present ? 19 : 18));
  return capture(
    {
      status: "configure_acknowledged",
      originalRecord,
      rawReceipt,
      receipt: r,
      operationalAuthority: false,
    },
    families,
    expected,
  );
}
/** Fixed control output has no raw values and no operational capability. */
export function configureControl(
  status: "not_dispatched" | "configure_unknown",
  reason: string,
) {
  return Object.freeze({ status, reason, operationalAuthority: false });
}

export function admitConfigureFailure(...args: Parameters<typeof failure>) {
  try {
    return failure(...args);
  } catch {
    return stop();
  }
}
export function admitConfigureACK(...args: Parameters<typeof ack>) {
  try {
    return ack(...args);
  } catch {
    return stop();
  }
}
