import { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";

// Coupons and products may have caller-supplied IDs. Do not require a prefix.
const id = z.string().min(1).max(255).regex(/\S/);
const resourceId = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const coupon = z
  .object({
    id,
    object: z.literal("coupon"),
    deleted: z.literal(false).optional(),
    duration: z.enum(["once", "repeating", "forever"]),
    applies_to: z
      .object({ products: z.array(id) })
      .strict()
      .optional(),
  })
  .passthrough();
const redemption = z
  .object({
    id: resourceId("di"),
    object: z.literal("discount"),
    deleted: z.literal(false).optional(),
    customer_account: resourceId("acct"),
    subscription: resourceId("sub").nullable(),
    subscription_item: resourceId("si").nullable(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative().nullable(),
    source: z.object({ type: z.literal("coupon"), coupon }).passthrough(),
  })
  .passthrough();
const reference = (object: string, identity = id) =>
  z.union([
    identity,
    z
      .object({
        id: identity,
        object: z.literal(object),
        deleted: z.literal(false).optional(),
      })
      .strict(),
  ]);
const inputSchema = z
  .object({
    customerAccountId: resourceId("acct"),
    subscriptionId: resourceId("sub"),
    level: z.enum(["subscription", "subscription_item"]),
    itemId: resourceId("si").optional(),
    currentProductId: id,
    targetProductId: id,
    redemptions: z.array(redemption).max(20),
    phaseDiscounts: z
      .array(
        z
          .object({
            discount: reference("discount", resourceId("di")),
            coupon: reference("coupon").nullable().optional(),
            promotion_code: z.null().optional(),
          })
          .passthrough(),
      )
      .max(20),
  })
  .strict();

type Reason =
  | "incomplete_discount_evidence"
  | "ambiguous_empty_discount_hierarchy"
  | "discount_not_owned_at_level"
  | "discount_duration_not_qualified"
  | "coupon_product_applicability"
  | "phase_redemption_mismatch"
  | "duplicate_redemptions";
export type RenewalDiscountProjection =
  | { status: "unsupported"; reason: Reason }
  | {
      status: "projected";
      discounts: { discount: string }[];
      requiresProviderQualification: true;
    };

/**
 * Project only a direct, unambiguous existing forever redemption. Ancestor-owned
 * redemptions are unsupported. Phase references must be IDs or minimal reference
 * objects; full expanded objects require separate normalization and correlation.
 * This field projection requires provider qualification before writer eligibility.
 */
export function projectRenewalDiscounts(
  input: unknown,
): RenewalDiscountProjection {
  let parsed: ReturnType<typeof inputSchema.safeParse>;
  try {
    parsed = inputSchema.safeParse(renewalSnapshot(input));
  } catch {
    return { status: "unsupported", reason: "incomplete_discount_evidence" };
  }
  if (!parsed.success)
    return { status: "unsupported", reason: "incomplete_discount_evidence" };
  const args = parsed.data;
  const unsupported = (reason: Reason): RenewalDiscountProjection => ({
    status: "unsupported",
    reason,
  });
  if (args.redemptions.length === 0 && args.phaseDiscounts.length === 0)
    return unsupported("ambiguous_empty_discount_hierarchy");
  if (args.redemptions.length !== args.phaseDiscounts.length)
    return unsupported("phase_redemption_mismatch");
  if (
    new Set(args.redemptions.map((v) => v.id)).size !== args.redemptions.length
  )
    return unsupported("duplicate_redemptions");
  const refId = (value: z.infer<ReturnType<typeof reference>>) =>
    typeof value === "string" ? value : value.id;
  for (const [index, value] of args.redemptions.entries()) {
    if (
      value.customer_account !== args.customerAccountId ||
      (args.level === "subscription" &&
        (value.subscription !== args.subscriptionId ||
          value.subscription_item !== null)) ||
      (args.level === "subscription_item" &&
        (!args.itemId ||
          value.subscription_item !== args.itemId ||
          (value.subscription !== null &&
            value.subscription !== args.subscriptionId)))
    )
      return unsupported("discount_not_owned_at_level");
    if (value.source.coupon.duration !== "forever" || value.end !== null)
      return unsupported("discount_duration_not_qualified");
    const products = value.source.coupon.applies_to?.products;
    if (
      products &&
      (!products.includes(args.currentProductId) ||
        !products.includes(args.targetProductId))
    )
      return unsupported("coupon_product_applicability");
    const phase = args.phaseDiscounts[index]!;
    if (
      refId(phase.discount) !== value.id ||
      (phase.coupon != null && refId(phase.coupon) !== value.source.coupon.id)
    )
      return unsupported("phase_redemption_mismatch");
  }
  return {
    status: "projected",
    discounts: args.redemptions.map(({ id: discount }) => ({ discount })),
    requiresProviderQualification: true,
  };
}
