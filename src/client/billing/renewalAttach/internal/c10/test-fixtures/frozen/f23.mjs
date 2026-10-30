import { requiredJSONSnapshot } from "./f20.mjs";
const ROLES = Object.freeze({
  creation: [
    "clock",
    "buyer",
    "originalProduct",
    "targetProduct",
    "originalPrice",
    "targetPrice",
    "subscriptionCoupon",
    "itemCoupon",
    "scheduledSubscription",
    "controlSubscription",
  ],
  baseline: [
    "mirrorInventory",
    "scheduledSubscription",
    "controlSubscription",
    "targetPrice",
    "billingCustomer",
    "subscriptionCoupon",
    "itemCoupon",
    "scheduledInvoice",
    "controlInvoice",
    "scheduledLines",
    "controlLines",
    "scheduledInventory",
    "controlInventory",
  ],
  pending: [
    "schedule",
    "scheduledSubscription",
    "controlSubscription",
    "targetPrice",
    "billingCustomer",
    "subscriptionCoupon",
    "itemCoupon",
    "scheduledLines",
    "controlLines",
    "scheduledInventory",
    "controlInventory",
  ],
  active: [
    "schedule",
    "scheduledSubscription",
    "controlSubscription",
    "targetPrice",
    "billingCustomer",
    "subscriptionCoupon",
    "itemCoupon",
    "scheduledLines",
    "controlLines",
    "scheduledInventory",
    "controlInventory",
    "scheduledInvoice",
    "controlInvoice",
    "clockReady",
    "nativeAdvance",
  ],
});
for (const a of Object.values(ROLES)) Object.freeze(a);
export const need = (x) => {
  if (!x) throw Error("PRE_T2_DISCOUNT_REFERENCE_UNSUPPORTED");
};
export const obj = (x) => {
  need(x && typeof x === "object" && !Array.isArray(x));
  return x;
};
export function closed(value, keys, optional = []) {
  obj(value);
  need(
    Object.keys(value).every((k) => keys.includes(k) || optional.includes(k)) &&
      keys.every((k) => Object.hasOwn(value, k)),
  );
  return value;
}
export function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
}
export function freeze(x) {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
}
export function boundary(raw) {
  const x = requiredJSONSnapshot(raw);
  closed(x, [
    "retainedProjectionInput",
    "desiredRequest",
    "storedConfigureRecord",
    "sourceRows",
  ]);
  for (const k of [
    "retainedProjectionInput",
    "desiredRequest",
    "storedConfigureRecord",
  ])
    obj(x[k]);
  closed(x.sourceRows, Object.keys(ROLES));
  for (const [stage, names] of Object.entries(ROLES)) {
    const records = closed(
      x.sourceRows[stage],
      names,
      stage === "active"
        ? ["finalizationAdvance", "nativeReadyBeforeFinalization"]
        : [],
    );
    if (stage === "active")
      need(
        Object.hasOwn(records, "finalizationAdvance") ===
          Object.hasOwn(records, "nativeReadyBeforeFinalization"),
      );
    for (const [role, r] of Object.entries(records)) {
      closed(r, ["request", "response"]);
      const method =
        stage === "creation" ||
        ["nativeAdvance", "finalizationAdvance"].includes(role)
          ? "POST"
          : "GET";
      closed(r.request, [
        "method",
        "path",
        "apiVersion",
        "scope",
        ...(method === "POST" ? ["params"] : []),
      ]);
      need(
        r.request.method === method &&
          r.request.apiVersion === "2026-09-30.endive" &&
          r.request.scope === "platform",
      );
      need(
        typeof r.request.path === "string" &&
          r.request.path.length > 0 &&
          r.request.path.length <= 8192,
      );
      closed(r.response, ["status", "requestId", "body"]);
      const q = r.response;
      need(Number.isInteger(q.status) && q.status >= 200 && q.status <= 299);
      need(
        q.requestId === null ||
          (typeof q.requestId === "string" &&
            q.requestId.length > 0 &&
            q.requestId.length <= 200),
      );
    }
  }
  return x;
}
