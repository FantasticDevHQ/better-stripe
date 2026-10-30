import { need, closed, freeze } from "../material/nodeKernel.js";
import { equal, referenceId } from "../../../renewalAggregate/shared.js";
import type { Bundle, FreshInput } from "../material/capture.js";

function object(value: unknown): Record<string, unknown> {
  need(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
const couponID = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 255 &&
  /\S/.test(id) &&
  id !== "." &&
  id !== "..";

/** Complete Coupon counterpart relation; no enriched body replaces retained raw JSON. */
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
          ]),
          association = closed(row.association, ["resource", "ordinal"]);
        need(
          row.couponId === id &&
            association.resource === "coupon" &&
            association.ordinal === 4 + i,
        );
        const c = object(row.wireCoupon);
        need(c.id === id && c.object === "coupon" && c.deleted !== true);
        ids.set(id, i);
      }
      const couponReadIndex = ids.get(id);
      need(couponReadIndex !== undefined);
      const coupon = b.couponReads[couponReadIndex].wireCoupon;
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

/** One explicit root schedule association transition, with all residual material equal. */
export function replayCouponEligibility(value: FreshInput) {
  const p = value.attachRequest.preparation,
    original = value.originalBundle,
    current = value.currentBundle;
  need(
    Object.prototype.hasOwnProperty.call(
      original.wireSubscription,
      "schedule",
    ) &&
      original.wireSubscription.schedule === null &&
      Object.prototype.hasOwnProperty.call(
        current.wireSubscription,
        "schedule",
      ) &&
      current.wireSubscription.schedule !== null,
  );
  const { schedule: oldAssociation, ...oldResidual } =
      original.wireSubscription,
    { schedule: currentAssociation, ...currentResidual } =
      current.wireSubscription;
  need(
    oldAssociation === null &&
      equal(p.subscription, original.wireSubscription) &&
      equal(oldResidual, currentResidual),
  );
  for (const [key, wire] of [
    ["targetPrice", "wireTargetPrice"],
    ["billingCustomer", "wireBillingCustomer"],
  ] as const)
    need(equal(p[key], original[wire]) && equal(original[wire], current[wire]));
  rebuild(original);
  const joined = rebuild(current);
  need(equal(original.couponReads, current.couponReads));
  const expected = p.expected,
    context = {
      customerAccountId: expected.customerAccountId,
      livemode: expected.livemode,
    };
  const scheduleId = referenceId(
      currentAssociation,
      "sub_sched",
      "subscription_schedule",
      context,
    ),
    customerId = referenceId(
      current.wireSubscription.customer,
      "cus",
      "customer",
      context,
    );
  function check(
    v: unknown,
    kind: "customer" | "subscription" | "subscription_schedule",
    depth: number,
  ): void {
    need(depth <= 40);
    const prefix =
        kind === "customer"
          ? "cus"
          : kind === "subscription"
            ? "sub"
            : "sub_sched",
      id =
        kind === "customer"
          ? customerId
          : kind === "subscription"
            ? expected.subscriptionId
            : scheduleId;
    need(referenceId(v, prefix, kind, context) === id);
    if (typeof v === "string") return;
    const node = object(v);
    need(
      !Object.prototype.hasOwnProperty.call(node, "deleted") ||
        node.deleted === false,
    );
    if (
      kind !== "customer" &&
      Object.prototype.hasOwnProperty.call(node, "customer")
    )
      check(node.customer, "customer", depth + 1);
    if (
      kind === "subscription" &&
      Object.prototype.hasOwnProperty.call(node, "schedule")
    )
      check(node.schedule, "subscription_schedule", depth + 1);
    if (
      kind === "subscription_schedule" &&
      Object.prototype.hasOwnProperty.call(node, "subscription")
    )
      check(node.subscription, "subscription", depth + 1);
  }
  check(current.wireSubscription, "subscription", 0);
  check(current.wireBillingCustomer, "customer", 0);
  return freeze(joined);
}
