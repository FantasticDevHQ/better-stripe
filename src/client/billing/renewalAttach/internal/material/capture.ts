import { types } from "node:util";
import { requiredJSONSnapshot } from "./requiredJson.js";
import { closed, need, freeze } from "./nodeKernel.js";
import { equal } from "../../../renewalAggregate/shared.js";
import type { PrepareRenewalPriceReplacementV2Options } from "../../../renewalV2/index.js";
type Data = Record<string, unknown>;
type Discount = Data & {
  id: unknown;
  source: Data & { coupon: string | Data };
};
type Subscription = Data & {
  schedule: unknown;
  discounts: Discount[];
  items: { data: { discounts: Discount[] }[] };
};
export type AttachRaw = {
  preparation: PrepareRenewalPriceReplacementV2Options & {
    subscription: Subscription;
    targetPrice: Data;
    billingCustomer?: Data;
  };
  apiVersion: string;
  attachKey: string;
  firstDispatchedAt: number;
};
export type Bundle = {
  wireSubscription: Subscription;
  wireTargetPrice: Data;
  wireBillingCustomer: Data;
  couponReads: {
    couponId: unknown;
    wireCoupon: Data;
    association: { resource: unknown; ordinal: unknown };
  }[];
  derivedCouponJoins: { subscription: unknown; item: unknown };
};
export type RetainedInput = {
  attachRequest: AttachRaw;
  originalBundle: Bundle;
};
export type FreshInput = RetainedInput & {
  currentBundle: Bundle;
  observedAt: number;
};
export type OwnedDiscounts = { subscription: unknown; item: unknown };
const isProxy = types.isProxy;
function rejectProxy(value: unknown) {
  const active = new Set<object>();
  let nodes = 0;
  function walk(x: unknown, depth: number) {
    need(++nodes <= 10000 && depth <= 40 && !isProxy(x));
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
      if (array && key === "length") continue;
      need(d.enumerable);
      walk(d.value, depth + 1);
    }
    active.delete(x);
  }
  walk(value, 0);
}
function attachShape(a: Record<string, unknown>) {
  const p = closed(
    a.preparation,
    ["subscription", "targetPrice", "expected", "key"],
    ["billingCustomer"],
  );
  closed(p.expected, [
    "customerAccountId",
    "subscriptionId",
    "itemId",
    "currentPriceId",
    "currentProductId",
    "targetPriceId",
    "targetProductId",
    "periodStart",
    "periodEnd",
    "livemode",
  ]);
}
function bundleShape(b: unknown) {
  const v = closed(b, [
    "wireSubscription",
    "wireTargetPrice",
    "wireBillingCustomer",
    "couponReads",
    "derivedCouponJoins",
  ]);
  closed(v.derivedCouponJoins, ["subscription", "item"]);
}
function retainedShape(raw: unknown) {
  const x = closed(raw, ["attachRequest", "originalBundle"]),
    a = closed(x.attachRequest, [
      "preparation",
      "apiVersion",
      "attachKey",
      "firstDispatchedAt",
    ]);
  attachShape(a);
  need(
    typeof a.apiVersion === "string" &&
      typeof a.attachKey === "string" &&
      typeof a.firstDispatchedAt === "number",
  );
  bundleShape(x.originalBundle);
}
function freshShape(raw: unknown) {
  const x = closed(raw, [
    "attachRequest",
    "originalBundle",
    "currentBundle",
    "observedAt",
  ]);
  need(Number.isSafeInteger(x.observedAt) && (x.observedAt as number) >= 0);
  const a = closed(x.attachRequest, [
    "preparation",
    "apiVersion",
    "attachKey",
    "firstDispatchedAt",
  ]);
  attachShape(a);
  for (const b of [x.originalBundle, x.currentBundle]) bundleShape(b);
}
export function captureRetainedInput(raw: unknown): RetainedInput {
  rejectProxy(raw);
  retainedShape(raw);
  const value = requiredJSONSnapshot(raw);
  retainedShape(value);
  return freeze(value) as RetainedInput;
}
export function captureOwnedInput(raw: unknown): FreshInput {
  rejectProxy(raw);
  freshShape(raw);
  const value = requiredJSONSnapshot(raw);
  freshShape(value);
  return freeze(value) as FreshInput;
}
const couponID = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 255 &&
  /\S/.test(id) &&
  id !== "." &&
  id !== "..";
function rebuild(b: Bundle) {
  const subscription = b.wireSubscription;
  need(
    subscription &&
      subscription.items &&
      Array.isArray(subscription.items.data) &&
      subscription.items.data.length === 1,
  );
  const lists = [subscription.discounts, subscription.items.data[0].discounts];
  need(lists.every((x) => Array.isArray(x) && x.length <= 20));
  need(Array.isArray(b.couponReads) && b.couponReads.length <= 40);
  const ids = new Map<string, number>();
  const joined = lists.map((list) =>
    list.map((discount, index) => {
      need(discount && discount.source);
      const ref = discount.source.coupon,
        id = typeof ref === "string" ? ref : ref?.id;
      need(couponID(id));
      if (!ids.has(id)) {
        const i = ids.size,
          row = closed(b.couponReads[i], [
            "couponId",
            "wireCoupon",
            "association",
          ]);
        const association = closed(row.association, ["resource", "ordinal"]);
        need(
          row.couponId === id &&
            association.resource === "coupon" &&
            association.ordinal === 4 + i,
        );
        const c = row.wireCoupon as Data;
        need(c && c.id === id && c.object === "coupon" && c.deleted !== true);
        ids.set(id, i);
      }
      const couponReadIndex = ids.get(id)!,
        coupon = b.couponReads[couponReadIndex].wireCoupon;
      need(typeof ref === "string" || equal(ref, coupon));
      const joinedDiscount = {
        ...discount,
        source: { ...discount.source, coupon },
      };
      return {
        index,
        discountId: discount.id,
        originalCouponReference: ref,
        couponReadIndex,
        joinedDiscount,
      };
    }),
  );
  need(
    ids.size === b.couponReads.length &&
      equal(b.derivedCouponJoins, { subscription: joined[0], item: joined[1] }),
  );
  return {
    subscription: joined[0].map((x) => x.joinedDiscount),
    item: joined[1].map((x) => x.joinedDiscount),
  };
}
export function ownedRetainedEligibility(value: RetainedInput) {
  const p = value.attachRequest.preparation,
    original = value.originalBundle;
  need(original.wireSubscription.schedule === null);
  for (const [key, wire] of [
    ["subscription", "wireSubscription"],
    ["targetPrice", "wireTargetPrice"],
    ["billingCustomer", "wireBillingCustomer"],
  ] as const)
    need(equal(p[key], original[wire]));
  return freeze(rebuild(original));
}
export function ownedCouponEligibility(value: FreshInput) {
  const p = value.attachRequest.preparation,
    original = value.originalBundle,
    current = value.currentBundle;
  need(
    original.wireSubscription.schedule === null &&
      current.wireSubscription.schedule === null,
  );
  for (const [key, wire] of [
    ["subscription", "wireSubscription"],
    ["targetPrice", "wireTargetPrice"],
    ["billingCustomer", "wireBillingCustomer"],
  ] as const)
    need(equal(p[key], original[wire]) && equal(original[wire], current[wire]));
  rebuild(original);
  const joined = rebuild(current);
  need(equal(original.couponReads, current.couponReads));
  return freeze(joined);
}
