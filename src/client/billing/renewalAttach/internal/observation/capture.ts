import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import type { Data, Diagnostics } from "./types.js";
const stop = (): never => {
  throw Error("OWNED_OBSERVATION_STOP");
};
const need: (x: unknown) => asserts x = (x) => {
  if (!x) stop();
};
const nativeResponsePrototype = Response.prototype;
const nativeStatusGetter = Object.getOwnPropertyDescriptor(
  nativeResponsePrototype,
  "status",
)!.get!;
const apply = Reflect.apply,
  isProxy = types.isProxy;
function closed(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Data {
  need(
    value !== null &&
      typeof value === "object" &&
      !isProxy(value) &&
      !Array.isArray(value),
  );
  const proto = Object.getPrototypeOf(value);
  need(proto === Object.prototype || proto === null);
  const keys = Reflect.ownKeys(value);
  need(
    required.every((k) => keys.includes(k)) &&
      keys.every(
        (k) => typeof k === "string" && [...required, ...optional].includes(k),
      ),
  );
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    need(d && d.enumerable && "value" in d);
  }
  return value as Data;
}
// Proxy-first complete traversal before ordinary privacy copying. Repeated ordinary
// references are charged per occurrence; only active-path cycles are rejected.
export function rejectProxyJSON(value: unknown, transportRoot = false) {
  const active = new Set<object>();
  let nodes = 0;
  function walk(x: unknown, depth: number, isRoot: boolean) {
    need(++nodes <= 10000 && depth <= 40);
    need(!isProxy(x));
    if (x === null || typeof x !== "object") return;
    need(!active.has(x));
    active.add(x);
    const array = Array.isArray(x),
      keys = Reflect.ownKeys(x);
    need(keys.length <= 10001);
    for (const key of keys) {
      need(typeof key === "string");
      const d = Object.getOwnPropertyDescriptor(x, key);
      need(d && "value" in d);
      if (isRoot && transportRoot && key === "lastResponse" && !d.enumerable)
        continue;
      if (array && key === "length") continue;
      need(d.enumerable);
      walk(d.value, depth + 1, false);
    }
    active.delete(x);
  }
  walk(value, 0, true);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ("value" in d) freeze(d.value);
    Object.freeze(value);
  }
  return value;
}
function ordinary<T>(value: T): T {
  rejectProxyJSON(value);
  return freeze(requiredJSONSnapshot(value)) as T;
}
export function captureObservationReply(reply: unknown) {
  rejectProxyJSON(reply, true);
  need(reply !== null && typeof reply === "object" && !Array.isArray(reply));
  const proto = Object.getPrototypeOf(reply);
  need(proto === Object.prototype || proto === null);
  const meta = Object.getOwnPropertyDescriptor(reply, "lastResponse");
  need(
    meta &&
      !meta.enumerable &&
      "value" in meta &&
      meta.value !== null &&
      typeof meta.value === "object",
  );
  const metadata = meta.value as object;
  need(!isProxy(metadata));
  const codes: unknown[] = [];
  for (const key of ["status", "statusCode"]) {
    const d = Object.getOwnPropertyDescriptor(metadata, key);
    if (!d) continue;
    need("value" in d);
    if (d.value !== undefined) codes.push(d.value);
  }
  if (Object.getPrototypeOf(metadata) === nativeResponsePrototype)
    codes.push(apply(nativeStatusGetter, metadata, []));
  need(
    codes.length > 0 &&
      codes.every(
        (x) =>
          typeof x === "number" &&
          Number.isInteger(x) &&
          x >= 200 &&
          x < 300 &&
          x === codes[0],
      ),
  );
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(reply)) {
    need(typeof key === "string");
    if (key === "lastResponse") continue;
    const d = Object.getOwnPropertyDescriptor(reply, key);
    need(d && d.enumerable && "value" in d);
    entries.push([key, d.value]);
  }
  return ordinary(Object.fromEntries(entries));
}
export function captureObservationInput<T>(value: T): T {
  const root = closed(value, ["configuration", "reads"], ["configureReceipt"]);
  const reads = closed(root.reads, [
    "schedule",
    "subscription",
    "targetPrice",
    "billingCustomer",
    "coupons",
  ]);
  need(Array.isArray(reads.coupons));
  return ordinary(value);
}
export function admitObservationOutput<T>(value: T): T {
  const root = closed(value, [
    "status",
    "observation",
    "reads",
    "observedAt",
    "retainedConfigureAcknowledgement",
    "operationalAuthority",
  ]);
  need(
    root.status === "owned_observation_data" &&
      root.operationalAuthority === false &&
      (root.retainedConfigureAcknowledgement === "absent" ||
        root.retainedConfigureAcknowledgement === "present"),
  );
  need(
    typeof root.observedAt === "number" &&
      Number.isSafeInteger(root.observedAt) &&
      root.observedAt >= 0,
  );
  const reads = closed(root.reads, [
    "schedule",
    "subscription",
    "targetPrice",
    "billingCustomer",
    "coupons",
  ]);
  need(Array.isArray(reads.coupons));
  const r = closed(
    root.observation,
    [
      "acknowledgementEstablished",
      "authenticationEstablished",
      "providerQualificationRequired",
      "predicate",
    ],
    [
      "reason",
      "observedItemId",
      "nativePeriod",
      "providerStatus",
      "effectiveness",
    ],
  );
  need(
    r.acknowledgementEstablished === false &&
      r.authenticationEstablished === false &&
      r.providerQualificationRequired === true,
  );
  need(
    typeof r.predicate === "string" &&
      [
        "pending_material_match",
        "current_target_material_match",
        "attached_unconfigured_match",
        "terminal_facts_only",
        "unknown",
        "conflict",
      ].includes(r.predicate),
  );
  for (const key of [
    "reason",
    "observedItemId",
    "providerStatus",
    "effectiveness",
  ])
    if (Object.prototype.hasOwnProperty.call(r, key))
      need(typeof r[key] === "string");
  if (Object.prototype.hasOwnProperty.call(r, "nativePeriod")) {
    const period = closed(r.nativePeriod, ["start", "end"]);
    need(
      Number.isSafeInteger(period.start) && Number.isSafeInteger(period.end),
    );
  }
  return ordinary(value);
}
// Only bounded own DATA is admitted. Diagnostics never authorize a failure.
export function safeReadDiagnostics(error: unknown): Diagnostics {
  const out: {
    type?: string;
    code?: string;
    statusCode?: number;
    requestId?: string;
  } = {};
  if (error === null || typeof error !== "object" || isProxy(error))
    return Object.freeze(out);
  for (const key of ["type", "code", "statusCode", "requestId"] as const) {
    const d = Object.getOwnPropertyDescriptor(error, key);
    if (!d || !("value" in d)) continue;
    const value: unknown = d.value;
    if (key === "statusCode") {
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
      )
        out[key] = value;
    } else if (
      typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 255
    ) {
      try {
        out[key] = requiredJSONSnapshot(value) as string;
      } catch {
        /* Unsupported diagnostics are omitted. */
      }
    }
  }
  return Object.freeze(out);
}
