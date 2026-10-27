import { z } from "zod";
import type Stripe from "stripe";
import { equal, object, unsupported } from "../renewalAggregate/shared.js";
import { readRenewalWireJSON } from "./wireJson.js";

const id = z.string().min(1).max(255).regex(/\S/);
const discount = z
  .object({
    id: z.string().regex(/^di_[A-Za-z0-9_]+$/),
    object: z.literal("discount"),
    deleted: z.literal(false).optional(),
    source: z
      .object({
        type: z.literal("coupon"),
        coupon: z.union([
          id,
          z
            .object({
              id,
              object: z.literal("coupon"),
              deleted: z.literal(false).optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  })
  .passthrough();
/** Explicit bounded joins, never a fallback for failed or over-depth expansion. */
export async function joinRenewalCoupons(
  stripe: Stripe,
  subscription: Record<string, unknown>,
  item: Record<string, unknown>,
  livemode: boolean,
) {
  const lists = [subscription.discounts, item.discounts].map((value) => {
    const parsed = z.array(discount).max(20).safeParse(value);
    if (!parsed.success)
      unsupported("incomplete_or_unsupported_discount_evidence");
    return parsed.data;
  });
  for (const list of lists)
    for (const redemption of list) {
      const ref = redemption.source.coupon;
      if (
        typeof ref !== "string" &&
        ref.livemode !== undefined &&
        ref.livemode !== livemode
      )
        unsupported("expanded_coupon_mode_mismatch");
    }
  const coupons = new Map<string, Record<string, unknown>>();
  for (const list of lists)
    for (const redemption of list) {
      const couponId =
        typeof redemption.source.coupon === "string"
          ? redemption.source.coupon
          : redemption.source.coupon.id;
      let coupon = coupons.get(couponId);
      if (!coupon) {
        coupon = object(await readRenewalWireJSON(stripe, "coupon", couponId));
        if (
          coupon.id !== couponId ||
          coupon.object !== "coupon" ||
          coupon.deleted === true ||
          (coupon.livemode !== undefined && coupon.livemode !== livemode)
        )
          unsupported("coupon_join_identity_mismatch");
        coupons.set(couponId, coupon);
      }
      // A join may expand a string reference, but must never replace facts
      // already present in a full read. Shape drift is conservatively rejected.
      if (
        typeof redemption.source.coupon !== "string" &&
        !equal(redemption.source.coupon, coupon)
      )
        unsupported("expanded_coupon_read_drift");
    }
  const joined = lists.map((list) =>
    list.map((redemption) => {
      const couponId =
        typeof redemption.source.coupon === "string"
          ? redemption.source.coupon
          : redemption.source.coupon.id;
      return {
        ...redemption,
        source: { ...redemption.source, coupon: coupons.get(couponId)! },
      };
    }),
  );
  return { subscriptionDiscounts: joined[0], itemDiscounts: joined[1] };
}
