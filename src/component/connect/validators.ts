import { type Infer, v } from "convex/values";

export const paymentStatusValidator = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("processing"),
  v.literal("requires_action"),
);
export type PaymentStatus = Infer<typeof paymentStatusValidator>;

export const payoutStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("in_transit"),
);
export type PayoutStatus = Infer<typeof payoutStatusValidator>;

/**
 * Field validators for the `payments` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const paymentFields = {
  stripePaymentIntentId: v.string(),
  userId: v.string(),
  orgId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  status: paymentStatusValidator,
  metadata: v.optional(v.any()),
};

/** Full `payments` document, including system fields. */
export const paymentDocValidator = v.object({
  _id: v.id("payments"),
  _creationTime: v.number(),
  ...paymentFields,
});

/**
 * Field validators for the `payouts` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const payoutFields = {
  stripePayoutId: v.string(),
  accountId: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: payoutStatusValidator,
  arrivalDate: v.optional(v.string()),
  method: v.optional(v.string()),
  metadata: v.optional(v.any()),
};

/** Full `payouts` document, including system fields. */
export const payoutDocValidator = v.object({
  _id: v.id("payouts"),
  _creationTime: v.number(),
  ...payoutFields,
});
