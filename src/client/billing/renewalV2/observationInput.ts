import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { captureConfiguration } from "./configureInput.js";
import { captureConfigurationReceipt } from "./configureReceipt.js";
import type {
  ProjectRenewalConfigurationV2Options,
  ConstructRenewalConfigurationReceiptV2Options,
} from "./index.js";
export type RenewalScheduleMaterialReads = {
  schedule: unknown;
  subscription: unknown;
  targetPrice: unknown;
  billingCustomer: unknown;
  coupons: unknown;
};
export type InspectRenewalScheduleMaterialV2Options = {
  configuration: ProjectRenewalConfigurationV2Options;
  reads: RenewalScheduleMaterialReads;
  configureReceipt?: ConstructRenewalConfigurationReceiptV2Options;
};
function stop(): never {
  throw Error("Invalid raw renewal observation.");
}
function fields(
  raw: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) stop();
  const p = Object.getPrototypeOf(raw);
  if (p !== Object.prototype && p !== null) stop();
  const keys = Reflect.ownKeys(raw);
  if (
    keys.some(
      (k) => typeof k !== "string" || ![...required, ...optional].includes(k),
    ) ||
    required.some((k) => !keys.includes(k))
  )
    stop();
  return Object.fromEntries(
    keys.map((k) => {
      const d = Object.getOwnPropertyDescriptor(raw, k);
      if (!d || !d.enumerable || !("value" in d)) stop();
      return [k, d.value];
    }),
  );
}
/** No getters, toJSON, symbols or hidden properties are stripped on this new raw API. */
function strictCopy(raw: unknown) {
  let nodes = 0,
    characters = 0;
  const seen = new Set<object>();
  function copy(x: unknown, depth: number): unknown {
    if (++nodes > 10000 || depth > 40) stop();
    if (typeof x === "string") {
      characters += x.length;
      if (characters > 500000) stop();
      return x;
    }
    if (x === null || typeof x === "boolean") return x;
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (!x || typeof x !== "object" || seen.has(x)) stop();
    const array = Array.isArray(x);
    if (!array) {
      const p = Object.getPrototypeOf(x);
      if (p !== Object.prototype && p !== null) stop();
    }
    seen.add(x);
    const keys = Reflect.ownKeys(x);
    const entries: [string, unknown][] = [];
    const selected = new Map<PropertyKey, unknown>();
    let length = 0;
    if (array) {
      const d = Object.getOwnPropertyDescriptor(x, "length");
      if (
        !d ||
        !("value" in d) ||
        !Number.isSafeInteger(d.value) ||
        d.value < 0 ||
        d.value > 10000
      )
        stop();
      length = d.value;
    }
    for (const k of keys) {
      if (array && k === "length") continue;
      if (typeof k !== "string") stop();
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!d || !d.enumerable || !("value" in d)) stop();
      characters += k.length;
      if (characters > 500000) stop();
      if (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= length))
        stop();
      selected.set(k, d.value);
      entries.push([k, copy(d.value, depth + 1)]);
    }
    const after = Reflect.ownKeys(x);
    if (after.length !== keys.length || after.some((k, i) => k !== keys[i]))
      stop();
    for (const [k, value] of selected) {
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!d || !d.enumerable || !("value" in d) || !Object.is(d.value, value))
        stop();
    }
    seen.delete(x);
    if (array) {
      if (entries.length !== length) stop();
      const map = new Map(entries);
      return Array.from({ length }, (_, i) => {
        if (!map.has(String(i))) stop();
        return map.get(String(i));
      });
    }
    return Object.fromEntries(entries);
  }
  return copy(raw, 0);
}
function capture(raw: unknown) {
  const original = fields(
    raw,
    ["configuration", "reads"],
    ["configureReceipt"],
  );
  const captured = renewalSnapshot(strictCopy(original));
  const root = fields(
    captured,
    ["configuration", "reads"],
    ["configureReceipt"],
  );
  if (new TextEncoder().encode(JSON.stringify(captured)).byteLength > 500000)
    stop();
  const configuration = captureConfiguration(root.configuration),
    reads = fields(root.reads, [
      "schedule",
      "subscription",
      "targetPrice",
      "billingCustomer",
      "coupons",
    ]);
  for (const body of [
    reads.schedule,
    reads.subscription,
    reads.targetPrice,
    reads.billingCustomer,
    ...(Array.isArray(reads.coupons) ? reads.coupons : []),
  ])
    if (
      body &&
      typeof body === "object" &&
      Object.prototype.hasOwnProperty.call(body, "lastResponse")
    )
      stop();
  const configureReceipt = Object.prototype.hasOwnProperty.call(
    root,
    "configureReceipt",
  )
    ? captureConfigurationReceipt(root.configureReceipt)
    : undefined;
  return { configuration, reads, configureReceipt };
}

export function captureObservation(raw: unknown) {
  try {
    return capture(raw);
  } catch {
    stop();
  }
}
