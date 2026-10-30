import { z } from "zod";
import { resourceId, unsupported } from "./f02.mjs";
const customId = z.string().min(1).max(255).regex(/\S/);
const originalRedemptions = z
  .array(
    z
      .object({
        id: resourceId("di"),
        object: z.literal("discount"),
        deleted: z.literal(false).optional(),
        customer_account: resourceId("acct"),
        customer: z
          .union([
            resourceId("cus"),
            z
              .object({
                id: resourceId("cus"),
                object: z.literal("customer"),
                deleted: z.literal(false).optional(),
                livemode: z.boolean().optional(),
                customer_account: resourceId("acct").nullable().optional(),
              })
              .passthrough(),
          ])
          .nullable()
          .optional(),
        subscription: resourceId("sub").nullable(),
        subscription_item: resourceId("si").nullable(),
        start: z.number().int().nonnegative(),
        end: z.null(),
        source: z
          .object({
            type: z.literal("coupon"),
            coupon: z
              .object({
                id: customId,
                object: z.literal("coupon"),
                deleted: z.literal(false).optional(),
                livemode: z.boolean().optional(),
                duration: z.literal("forever"),
                applies_to: z
                  .object({ products: z.array(customId) })
                  .strict()
                  .optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  )
  .max(20);
export function qualifySourceDiscounts(
  value,
  level,
  context,
  customerId,
  observedAt,
) {
  const parsed = originalRedemptions.safeParse(value);
  if (!parsed.success)
    unsupported("incomplete_or_unsupported_discount_evidence");
  if (!parsed.data.length) unsupported("ambiguous_empty_discount_hierarchy");
  if (
    new Set(parsed.data.map((discount) => discount.id)).size !==
    parsed.data.length
  )
    unsupported("duplicate_discount_redemptions");
  for (const discount of parsed.data) {
    const customer = discount.customer;
    if (
      discount.customer_account !== context.customerAccountId ||
      discount.start > observedAt ||
      (typeof customer === "string" && customer !== customerId) ||
      (typeof customer === "object" &&
        customer !== null &&
        (customer.id !== customerId ||
          (customer.livemode !== undefined &&
            customer.livemode !== context.livemode) ||
          (customer.customer_account !== undefined &&
            customer.customer_account !== context.customerAccountId))) ||
      (level === "subscription" &&
        (discount.subscription !== context.subscriptionId ||
          discount.subscription_item !== null)) ||
      (level === "item" &&
        (discount.subscription_item !== context.itemId ||
          (discount.subscription !== null &&
            discount.subscription !== context.subscriptionId)))
    )
      unsupported("discount_owner_or_start_mismatch");
    const coupon = discount.source.coupon;
    if (coupon.livemode !== undefined && coupon.livemode !== context.livemode)
      unsupported("discount_coupon_mode_mismatch");
    if (
      coupon.applies_to &&
      (!coupon.applies_to.products.includes(context.currentProductId) ||
        !coupon.applies_to.products.includes(context.targetProductId))
    )
      unsupported("discount_product_applicability");
  }
  return parsed.data;
}
