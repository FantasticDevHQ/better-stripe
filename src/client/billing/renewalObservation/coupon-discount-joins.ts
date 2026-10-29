import { object, array, need, clone, get, equal, type O } from "./common.js";
import type { identities } from "./scheduled-identity.js";
export function redemptions(
  state: Extract<ReturnType<typeof identities>, { kind: "continue" }>["state"],
) {
  const {
    expected,
    originalSub,
    originalItem,
    reads,
    sub,
    ref,
    customerId,
    actualItem,
  } = state;
  // BEGIN original 416-559
  const couponRows = array(reads.coupons);
  need(couponRows.length <= 40, "coupon_budget_exceeded", "unknown");
  const couponMap = new Map<string, O>();
  for (const row of couponRows) {
    const c = object(row);
    need(
      typeof c.id === "string" &&
        c.id.trim().length > 0 &&
        c.object === "coupon" &&
        c.deleted !== true &&
        c.livemode === expected.livemode,
      "coupon_join_identity_mismatch",
    );
    need(!couponMap.has(c.id), "duplicate_coupon_read", "unknown");
    couponMap.set(c.id, c);
  }
  const coupon = (v: unknown): O => {
    const id = typeof v === "string" ? v : object(v).id;
    need(
      typeof id === "string" && couponMap.has(id),
      "missing_correlated_coupon",
      "unknown",
    );
    const fetched = couponMap.get(id as string)!;
    if (typeof v !== "string")
      need(equal(v, fetched), "expanded_coupon_read_drift");
    return clone(fetched);
  };
  const discounts = (
    v: unknown,
    level: "subscription" | "item",
    itemId: string,
  ): O[] => {
    const rows = array(v);
    need(rows.length <= 20, "discount_budget_exceeded", "unknown");
    return rows.map((row) => {
      const d = clone(object(row));
      need(
        typeof d.id === "string" &&
          /^di_[A-Za-z0-9_]+$/.test(d.id) &&
          d.object === "discount" &&
          d.deleted !== true &&
          d.customer_account === expected.customerAccountId,
        "discount_identity_mismatch",
      );
      if (d.customer !== undefined)
        need(
          ref(d.customer, "cus", "customer") === customerId,
          "discount_customer_mismatch",
        );
      need(
        level === "subscription"
          ? d.subscription === expected.subscriptionId &&
              d.subscription_item === null
          : d.subscription_item === itemId &&
              (d.subscription === null ||
                d.subscription === expected.subscriptionId),
        "discount_level_owner_mismatch",
        "unknown",
      );
      const source = get(d, "source");
      need(source.type === "coupon", "unsupported_discount_source", "unknown");
      source.coupon = coupon(source.coupon);
      const c = object(source.coupon);
      need(
        c.duration === "forever" && d.end === null,
        "discount_duration_unqualified",
        "unknown",
      );
      if (c.applies_to !== undefined) {
        const products = array(get(c, "applies_to").products);
        need(
          products.includes(expected.currentProductId) &&
            products.includes(expected.targetProductId),
          "coupon_product_applicability",
        );
      }
      d.source = source;
      d.customer = d.customer === undefined ? undefined : customerId;
      if (d.customer === undefined) delete d.customer;
      // Validation-view marker only. Both actual ownerships are checked first;
      // raw historical/current IDs remain untouched in rawReads/original records.
      if (level === "item") {
        d.subscription = expected.subscriptionId;
        d.subscription_item = "AUTHORIZED_CURRENT_ITEM";
      }
      return d;
    });
  };
  const wantedItemId = String(actualItem.id);
  const actualSubDiscounts = discounts(
      sub.discounts,
      "subscription",
      wantedItemId,
    ),
    actualItemDiscounts = discounts(actualItem.discounts, "item", wantedItemId);
  const originalSubDiscounts = discounts(
    originalSub.discounts,
    "subscription",
    String(expected.itemId),
  );
  const originalItemDiscounts = discounts(
    originalItem.discounts,
    "item",
    String(expected.itemId),
  );
  need(
    equal(actualSubDiscounts, originalSubDiscounts) &&
      equal(actualItemDiscounts, originalItemDiscounts),
    "redemption_full_read_drift",
  );
  const neededCouponIds = new Set(
    [
      ...array(originalSub.discounts),
      ...array(originalItem.discounts),
      ...array(sub.discounts),
      ...array(actualItem.discounts),
    ].map((row) => {
      const value = get(object(row), "source").coupon;
      return typeof value === "string" ? value : String(object(value).id);
    }),
  );
  need(
    couponMap.size === neededCouponIds.size &&
      [...couponMap.keys()].every((id) => neededCouponIds.has(id)),
    "unreferenced_coupon_read",
    "unknown",
  );
  const currentRedemptions = new Map<string, O>();
  for (const d of [...array(sub.discounts), ...array(actualItem.discounts)]) {
    const raw = clone(object(d));
    const source = get(raw, "source");
    source.coupon = coupon(source.coupon);
    raw.source = source;
    currentRedemptions.set(String(raw.id), raw);
  }
  // END original 416-559
  return {
    ...state,
    coupon,
    actualItemDiscounts,
    actualSubDiscounts,
    originalItemDiscounts,
    originalSubDiscounts,
    currentRedemptions,
  };
}
