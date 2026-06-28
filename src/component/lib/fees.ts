import { type Infer, v } from "convex/values";

/**
 * Shared fee & fund-routing validators (BTS-11).
 *
 * These fields are denormalized onto the billing/connect tables so a single
 * read answers "where did this money go and what did the platform keep?".
 *
 * Two charge patterns:
 *  - `destination` — single recipient; funds routed via Stripe `transfer_data`
 *    + `application_fee_*` on the charge/subscription.
 *  - `separate`    — multiple recipients (store + affiliate); platform charges,
 *    then creates one `Transfer` per recipient (transfer-math fee, never
 *    `application_fee`). See [[marketplace-economics-plan]] M2/M3.
 */
export const chargeTypeValidator = v.union(
  v.literal("destination"),
  v.literal("separate"),
);
export type ChargeType = Infer<typeof chargeTypeValidator>;

export const splitRecipientRoleValidator = v.union(
  v.literal("store"),
  v.literal("affiliate"),
  v.literal("other"),
);
export type SplitRecipientRole = Infer<typeof splitRecipientRoleValidator>;

/**
 * One destination in a multi-recipient split. The cut is expressed as either a
 * fixed `amount` (minor units) or a `percent` of the net; the resolver (BTS-14)
 * decides precedence. App-owned attribution (who the affiliate is) lives in app
 * tables — the component just records and executes the split.
 */
export const splitRecipientValidator = v.object({
  destinationAccountId: v.string(),
  role: splitRecipientRoleValidator,
  amount: v.optional(v.number()),
  percent: v.optional(v.number()),
});
export type SplitRecipient = Infer<typeof splitRecipientValidator>;

/**
 * Optional fee/routing fields spread into the `subscriptions`,
 * `checkoutSessions`, `invoices`, and `payments` field validators (and the
 * matching upsert mutation args). All optional and back-compatible — existing
 * rows are unaffected.
 */
export const feeRoutingFields = {
  /** Single-recipient destination (the seller) for destination charges. */
  destinationAccountId: v.optional(v.string()),
  /** Fixed platform fee in minor units (one-time / per-invoice). */
  applicationFeeAmount: v.optional(v.number()),
  /** Percentage platform fee (subscriptions: Stripe `application_fee_percent`). */
  applicationFeePercent: v.optional(v.number()),
  /** Fee actually collected, denormalized from webhooks. */
  feeCollectedAmount: v.optional(v.number()),
  /** Which money mechanism produced this row. */
  chargeType: v.optional(chargeTypeValidator),
  /** Multi-recipient split (store + affiliate[s]) for separate charges & transfers. */
  splitRecipients: v.optional(v.array(splitRecipientValidator)),
};
