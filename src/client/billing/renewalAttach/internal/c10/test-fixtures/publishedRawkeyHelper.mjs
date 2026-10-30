// NEW synthetic Source-only variations, declared before any public child construction.
import { createHash } from "node:crypto";
import { fixture as rawFixture } from "./frozen/f18.mjs";
export const copy = (x) => structuredClone(x);
export const own = (body, key, value = { SYNTHETIC_RETAINED: true }) =>
  Object.defineProperty(body, key, {
    value: copy(value),
    enumerable: true,
    writable: true,
    configurable: true,
  });
export function order(x) {
  if (Array.isArray(x)) return x.map(order);
  if (x !== null && typeof x === "object")
    return Object.fromEntries(
      Object.entries(x)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, order(v)]),
    );
  return x;
}
export const binding = (family, preimage) =>
  family +
  ":v2:sha256:" +
  createHash("sha256")
    .update(
      JSON.stringify(
        order(["betterstripe-renewal-binding", 2, family, preimage]),
      ),
      "utf8",
    )
    .digest("hex");
export function expectedPrepared(raw) {
  const bound = {
    version: 2,
    scope: "platform",
    expected: copy(raw.expected),
    quantity: raw.subscription.items.data[0].quantity,
    providerSnapshot: {
      subscription: copy(raw.subscription),
      targetPrice: copy(raw.targetPrice),
      ...(Object.hasOwn(raw, "billingCustomer")
        ? { billingCustomer: copy(raw.billingCustomer) }
        : {}),
    },
  };
  return {
    ...bound,
    status: "prepared",
    preservation: "requires_schedule_validation",
    requestIdentity: { key: raw.key, binding: binding("renewal", bound) },
  };
}
export const wire = (x) => ({
  scope: x.scope,
  apiVersion: x.apiVersion,
  method: x.method,
  path: x.path,
  payload: copy(x.payload),
  key: x.key,
  firstDispatchedAt: x.firstDispatchedAt,
});
export function attachCase(field, key, replay = false) {
  const x = rawFixture().freshAttach;
  own(x.attachRequest.preparation[field], key);
  own(x[field === "subscription" ? "freshSubscription" : field], key);
  if (replay) {
    x.intent = "replay_unknown";
    x.freshSubscription.schedule = "sub_sched_ObservedSYNTHETIC";
  }
  return x;
}
export function configureCase() {
  const x = rawFixture().freshConfigure,
    c = x.configuration;
  for (const field of ["subscription", "targetPrice", "billingCustomer"]) {
    own(c.preparation[field], "__proto__");
    own(c.attachReceipt.attachRequest.preparation[field], "__proto__");
    own(c[field === "subscription" ? "freshSubscription" : field], "__proto__");
    own(x[field === "subscription" ? "freshSubscription" : field], "__proto__");
  }
  for (const body of [c.attachReceipt.providerSnapshot, c.schedule, x.schedule])
    own(body, "__proto__", { SYNTHETIC_SCHEDULE: true });
  return x;
}
export function measure(x) {
  let nodes = 0,
    depth = 0;
  function walk(v, n) {
    nodes++;
    depth = Math.max(depth, n);
    if (v !== null && typeof v === "object")
      for (const child of Object.values(v)) walk(child, n + 1);
  }
  walk(x, 0);
  const text = JSON.stringify(x);
  return {
    chars: text.length,
    utf8: Buffer.byteLength(text, "utf8"),
    nodes,
    depth,
  };
}
export { rawFixture };
