import type { Read } from "./rawWireSource.js";
import type { createReadLifetime } from "./readLifetime.js";
import { z } from "zod";
import { equal } from "../../../renewalAggregate/shared.js";
const need: (x: unknown) => asserts x = (x) => {
  if (!x) throw Error("RAW_ACQUISITION_STOP");
};
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
type Discount = z.infer<typeof discount>;
export async function acquireCouponJoins(
  subscription: Record<string, unknown>,
  item: Record<string, unknown>,
  livemode: boolean,
  read: Read,
  lifetime: ReturnType<typeof createReadLifetime>,
) {
  const rawLists = [subscription.discounts, item.discounts];
  const lists = rawLists as Discount[][];
  for (const list of lists) {
    need(z.array(discount).max(20).safeParse(list).success);
    for (const d of list) {
      const ref = d.source.coupon;
      need(
        typeof ref === "string" ||
          ref.livemode === undefined ||
          ref.livemode === livemode,
      );
    }
  }
  const ids = new Map<string, number | null>();
  for (const list of lists)
    for (const d of list) {
      const ref = d.source.coupon,
        key = typeof ref === "string" ? ref : ref.id;
      if (!ids.has(key)) ids.set(key, null);
    }
  need(ids.size <= 40);
  const couponReads: {
    couponId: string;
    wireCoupon: Record<string, unknown>;
    association: { resource: string; ordinal: number };
  }[] = [];
  for (const list of lists)
    for (const d of list) {
      const ref = d.source.coupon,
        key = typeof ref === "string" ? ref : ref.id;
      if (ids.get(key) === null) {
        const coupon = await read("coupon", key);
        lifetime.check();
        need(
          coupon.id === key &&
            coupon.object === "coupon" &&
            coupon.deleted !== true &&
            (coupon.livemode === undefined || coupon.livemode === livemode),
        );
        ids.set(key, couponReads.length);
        couponReads.push({
          couponId: key,
          wireCoupon: coupon,
          association: { resource: "coupon", ordinal: 4 + couponReads.length },
        });
      }
      // Preserve maintained failure frontier: compare this full expanded read before any next GET.
      need(
        typeof ref === "string" ||
          equal(ref, couponReads[ids.get(key)!].wireCoupon),
      );
    }
  const derived = lists.map((list) =>
    list.map((d, index) => {
      const ref = d.source.coupon,
        key = typeof ref === "string" ? ref : ref.id,
        couponReadIndex = ids.get(key)!,
        coupon = couponReads[couponReadIndex].wireCoupon;
      return {
        index,
        discountId: d.id,
        originalCouponReference: ref,
        couponReadIndex,
        joinedDiscount: { ...d, source: { ...d.source, coupon } },
      };
    }),
  );
  return {
    couponReads,
    derivedCouponJoins: { subscription: derived[0], item: derived[1] },
  };
}
