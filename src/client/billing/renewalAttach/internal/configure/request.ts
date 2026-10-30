import { types } from "node:util";
import { requiredJSONSnapshot } from "../material/requiredJson.js";
import { resourceId } from "../../../renewalAggregate/shared.js";
import { closed } from "../operations/types.js";
import type { PreflightRecord } from "../preflight/grammar.js";
import type { ProjectedRenewalConfigurationV2 } from "../../../renewalV2/index.js";

export const API = "2026-09-30.endive";
export const stop = (): never => {
  throw Error("CONFIGURE_WRITE_STOP");
};
export function need(value: unknown): asserts value {
  if (!value) stop();
}
export type SourceMethod = (...args: unknown[]) => unknown;
export function ownMethod(raw: unknown, key: string): SourceMethod {
  need(raw !== null && typeof raw === "object" && !types.isProxy(raw));
  const d = Object.getOwnPropertyDescriptor(raw, key);
  need(
    d &&
      d.enumerable &&
      "value" in d &&
      typeof d.value === "function" &&
      !types.isProxy(d.value),
  );
  return d.value as SourceMethod;
}
type Resource = "subscription" | "price" | "customer" | "coupon" | "schedule";
export type Row = Readonly<{
  resource: Resource;
  ordinal: number;
  method: "GET";
  path: string;
  body: undefined;
  id: string;
  options: Readonly<{ apiVersion: typeof API; maxNetworkRetries: 0 }>;
}>;
const query =
  "?" +
  new URLSearchParams(
    ["discounts", "items.data.discounts", "items.data.price"].map(
      (value, i) => ["expand[" + i + "]", value],
    ),
  );
const plurals = {
  subscription: "subscriptions",
  price: "prices",
  customer: "customers",
  coupon: "coupons",
  schedule: "subscription_schedules",
};
const prefixes = {
  subscription: "sub",
  price: "price",
  customer: "cus",
  schedule: "sub_sched",
};
function idFor(resource: Resource, path: string): string {
  const root = "/v1/" + plurals[resource] + "/";
  need(path.startsWith(root));
  if (resource === "subscription") need(path.endsWith(query));
  const encoded = path.slice(
    root.length,
    resource === "subscription" ? -query.length : undefined,
  );
  let id: string;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    return stop();
  }
  need(encodeURIComponent(id) === encoded);
  if (resource === "coupon")
    need(
      id.length >= 1 &&
        id.length <= 255 &&
        /\S/.test(id) &&
        id !== "." &&
        id !== "..",
    );
  else need(resourceId(prefixes[resource]).safeParse(id).success);
  return id;
}
/** Stateless closed fixed44 profile; explicit undefined bodies are never JSON encoded. */
export function capturePlan(raw: unknown): readonly Row[] {
  need(
    !types.isProxy(raw) &&
      Array.isArray(raw) &&
      Object.getPrototypeOf(raw) === Array.prototype,
  );
  const length = Object.getOwnPropertyDescriptor(raw, "length"),
    count: unknown = length?.value;
  need(
    length &&
      "value" in length &&
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 4 &&
      count <= 44,
  );
  const keys = Reflect.ownKeys(raw);
  need(keys.length === count + 1 && keys.every((k) => typeof k === "string"));
  const result: Row[] = [],
    coupons = new Set<string>();
  for (let i = 0; i < count; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    need(d && d.enumerable && "value" in d && !types.isProxy(d.value));
    const row = closed(d.value, [
      "resource",
      "ordinal",
      "method",
      "path",
      "body",
      "options",
    ]);
    need(!types.isProxy(row.options));
    const options = closed(row.options, ["apiVersion", "maxNetworkRetries"]);
    const resource: Resource =
      i === 0
        ? "subscription"
        : i === 1
          ? "price"
          : i === 2
            ? "customer"
            : i === count - 1
              ? "schedule"
              : "coupon";
    need(
      row.resource === resource &&
        row.ordinal === i + 1 &&
        row.method === "GET" &&
        typeof row.path === "string" &&
        row.body === undefined &&
        options.apiVersion === API &&
        options.maxNetworkRetries === 0,
    );
    const id = idFor(resource, row.path);
    requiredJSONSnapshot(row.path);
    if (resource === "coupon") {
      need(!coupons.has(id));
      coupons.add(id);
    }
    result.push(
      Object.freeze({
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
  need(coupons.size <= 40);
  return Object.freeze(result);
}
export function samePlan(a: readonly Row[], b: readonly Row[]) {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const s = b[i];
      return (
        r.resource === s.resource &&
        r.ordinal === s.ordinal &&
        r.method === s.method &&
        r.path === s.path &&
        r.body === s.body &&
        r.id === s.id &&
        r.options.apiVersion === s.options.apiVersion &&
        r.options.maxNetworkRetries === s.options.maxNetworkRetries
      );
    })
  );
}
export function expectedPlan(record: PreflightRecord) {
  const e = record.configuration.preparation.expected,
    customer = record.originalBundle.wireBillingCustomer.id;
  need(typeof customer === "string");
  const paths = [
    "/v1/subscriptions/" + encodeURIComponent(e.subscriptionId) + query,
    "/v1/prices/" + encodeURIComponent(e.targetPriceId),
    "/v1/customers/" + encodeURIComponent(customer),
    ...record.originalBundle.couponReads.map((row) => {
      need(typeof row.couponId === "string");
      return "/v1/coupons/" + encodeURIComponent(row.couponId);
    }),
    "/v1/subscription_schedules/" +
      encodeURIComponent(record.attachReceipt.scheduleId),
  ];
  return capturePlan(
    paths.map((path, i) => ({
      resource:
        i === 0
          ? "subscription"
          : i === 1
            ? "price"
            : i === 2
              ? "customer"
              : i === paths.length - 1
                ? "schedule"
                : "coupon",
      ordinal: i + 1,
      method: "GET",
      path,
      body: undefined,
      options: { apiVersion: API, maxNetworkRetries: 0 },
    })),
  );
}
export function assertRequest(
  raw: unknown,
): asserts raw is ProjectedRenewalConfigurationV2 {
  need(!types.isProxy(raw));
  const r = closed(raw, [
    "version",
    "stage",
    "scope",
    "apiVersion",
    "logicalBinding",
    "scheduleId",
    "method",
    "path",
    "key",
    "payload",
    "firstDispatchedAt",
    "attachReceiptBinding",
    "baselineBinding",
    "defaultSettingsBinding",
    "status",
    "providerQualification",
    "profile",
    "requestIdentity",
  ]);
  need(
    r.version === 2 &&
      r.stage === "configure" &&
      r.scope === "platform" &&
      r.apiVersion === API &&
      r.method === "POST" &&
      r.status === "projected_configure_request" &&
      r.providerQualification === "required",
  );
  need(
    typeof r.scheduleId === "string" &&
      resourceId("sub_sched").safeParse(r.scheduleId).success &&
      r.path === "/v1/subscription_schedules/" + r.scheduleId,
  );
  need(
    typeof r.key === "string" &&
      r.key.length >= 1 &&
      r.key.length <= 255 &&
      typeof r.firstDispatchedAt === "number" &&
      Number.isSafeInteger(r.firstDispatchedAt) &&
      r.firstDispatchedAt >= 0,
  );
  need(!types.isProxy(r.profile) && !types.isProxy(r.requestIdentity));
  const p = closed(r.profile, [
      "apiVersion",
      "billingMode",
      "cadence",
      "anchor",
    ]),
    identity = closed(r.requestIdentity, ["key", "binding"]);
  need(
    p.apiVersion === API &&
      (p.billingMode === "classic" || p.billingMode === "flexible") &&
      (p.cadence === "same" || p.cadence === "changed") &&
      (p.anchor === "ordinary" || p.anchor === "calendar_edge") &&
      identity.key === r.key,
  );
  need(!types.isProxy(r.payload));
  const payload = closed(r.payload, [
    "end_behavior",
    "proration_behavior",
    "phases",
  ]);
  need(
    payload.end_behavior === "release" &&
      payload.proration_behavior === "none" &&
      !types.isProxy(payload.phases) &&
      Array.isArray(payload.phases) &&
      payload.phases.length === 2,
  );
  requiredJSONSnapshot({ key: r.key, payload: r.payload, profile: p });
}
export function seven(
  request: ProjectedRenewalConfigurationV2,
): Readonly<
  Pick<
    ProjectedRenewalConfigurationV2,
    | "scope"
    | "apiVersion"
    | "method"
    | "path"
    | "payload"
    | "key"
    | "firstDispatchedAt"
  >
> {
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  return Object.freeze({
    scope,
    apiVersion,
    method,
    path,
    payload,
    key,
    firstDispatchedAt,
  });
}
