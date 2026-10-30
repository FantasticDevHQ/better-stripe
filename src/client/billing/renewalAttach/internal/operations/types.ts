import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import type { prepareRenewalScheduleAttachmentV2 } from "../../../renewalV2/index.js";

export type AttachRequest = Awaited<
  ReturnType<typeof prepareRenewalScheduleAttachmentV2>
>;
export type ReadResource = "subscription" | "price" | "customer" | "coupon";
export type ReadOptions = Readonly<{
  apiVersion: string;
  maxNetworkRetries: 0;
}>;
export type ReadRow = Readonly<{
  resource: ReadResource;
  ordinal: number;
  method: "GET";
  path: string;
  body: undefined;
  options: ReadOptions;
  id: string;
}>;
export type SourceMethod = (...args: unknown[]) => unknown;
export const stop = (): never => {
  throw Error("OWNED_TRANSPORT_STOP");
};
export function need(value: unknown): asserts value {
  if (!value) stop();
}

export function closed(
  raw: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  need(
    raw &&
      typeof raw === "object" &&
      !types.isProxy(raw) &&
      !Array.isArray(raw),
  );
  const prototype = Object.getPrototypeOf(raw);
  need(prototype === Object.prototype || prototype === null);
  const names = Reflect.ownKeys(raw);
  need(
    names.length === keys.length && keys.every((key) => names.includes(key)),
  );
  return Object.fromEntries(
    names.map((key) => {
      need(typeof key === "string");
      const d = Object.getOwnPropertyDescriptor(raw, key);
      need(d && d.enumerable && "value" in d);
      return [key, d.value];
    }),
  );
}

export function freezeJSON<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
}

const API = "2026-09-30.endive";
const resourceID = (value: unknown, prefix: string): value is string =>
  typeof value === "string" &&
  new RegExp("^" + prefix + "_[A-Za-z0-9_]+$").test(value) &&
  value.length <= 255;
const query = String(
  new URLSearchParams(
    ["discounts", "items.data.discounts", "items.data.price"].map((v, i) => [
      "expand[" + i + "]",
      v,
    ]),
  ),
);

/** Validates DATA only; never selects Owner, delegate, invocation or capability. */
export function captureRequestAndReads(
  requestRaw: unknown,
  readPlanRaw: unknown,
) {
  const r = closed(requestRaw, [
    "version",
    "stage",
    "scope",
    "apiVersion",
    "method",
    "path",
    "payload",
    "key",
    "firstDispatchedAt",
    "logicalBinding",
    "requestIdentity",
  ]);
  const payload = closed(r.payload, ["from_subscription"]),
    identity = closed(r.requestIdentity, ["key", "binding"]);
  need(
    r.version === 2 &&
      r.stage === "attach" &&
      r.scope === "platform" &&
      r.apiVersion === API &&
      r.method === "POST" &&
      r.path === "/v1/subscription_schedules" &&
      resourceID(payload.from_subscription, "sub"),
  );
  need(
    typeof r.key === "string" &&
      r.key.length > 0 &&
      r.key.length <= 255 &&
      identity.key === r.key &&
      typeof r.firstDispatchedAt === "number" &&
      Number.isSafeInteger(r.firstDispatchedAt) &&
      r.firstDispatchedAt >= 0,
  );
  requiredJSONSnapshot(r.key);
  need(
    typeof r.logicalBinding === "string" &&
      /^renewal:v2:sha256:[0-9a-f]{64}$/.test(r.logicalBinding) &&
      typeof identity.binding === "string" &&
      /^renewal-attach:v2:sha256:[0-9a-f]{64}$/.test(identity.binding),
  );
  // Every field in this closed C2 view was checked above; this is not proof admission.
  const request = Object.freeze({
    ...r,
    payload: freezeJSON(requiredJSONSnapshot(payload)),
    requestIdentity: Object.freeze(identity),
  }) as AttachRequest;
  need(
    Array.isArray(readPlanRaw) &&
      !types.isProxy(readPlanRaw) &&
      readPlanRaw.length >= 3 &&
      readPlanRaw.length <= 43,
  );
  const rawPlan: readonly unknown[] = readPlanRaw,
    plan: ReadRow[] = [],
    ids = new Set<string>();
  for (let i = 0; i < rawPlan.length; i++) {
    const row = closed(rawPlan[i], [
        "resource",
        "ordinal",
        "method",
        "path",
        "body",
        "options",
      ]),
      options = closed(row.options, ["apiVersion", "maxNetworkRetries"]);
    need(
      row.ordinal === i + 1 &&
        row.method === "GET" &&
        typeof row.path === "string" &&
        row.body === undefined &&
        options.apiVersion === API &&
        options.maxNetworkRetries === 0,
    );
    let id: string;
    const resource: ReadResource =
      i === 0
        ? "subscription"
        : i === 1
          ? "price"
          : i === 2
            ? "customer"
            : "coupon";
    if (i === 0) {
      need(
        row.resource === "subscription" &&
          row.path ===
            "/v1/subscriptions/" + payload.from_subscription + "?" + query,
      );
      id = payload.from_subscription;
    } else if (i === 1) {
      need(row.resource === "price" && row.path.startsWith("/v1/prices/"));
      id = row.path.slice(11);
      need(resourceID(id, "price"));
    } else if (i === 2) {
      need(
        row.resource === "customer" && row.path.startsWith("/v1/customers/"),
      );
      id = row.path.slice(14);
      need(resourceID(id, "cus"));
    } else {
      need(row.resource === "coupon" && row.path.startsWith("/v1/coupons/"));
      const encoded = row.path.slice(12);
      try {
        id = decodeURIComponent(encoded);
      } catch {
        return stop();
      }
      need(
        id.length > 0 &&
          id.length <= 255 &&
          /\S/.test(id) &&
          id !== "." &&
          id !== ".." &&
          encodeURIComponent(id) === encoded &&
          !ids.has(id),
      );
      ids.add(id);
    }
    plan.push(
      Object.freeze({
        ...row,
        resource,
        ordinal: i + 1,
        method: "GET",
        path: row.path,
        body: undefined,
        id,
        options: Object.freeze({ apiVersion: API, maxNetworkRetries: 0 }),
      }),
    );
  }
  return Object.freeze({ request, plan: Object.freeze(plan) });
}

/** Actor continuation surface only; this type grants no Source capability. */
export type FailureControl = {
  forward(error: unknown): object | null;
  consume(error: unknown): Error | null;
  consumePost(error: unknown): Error | null;
  takePostQuarantine(): object | null;
};
