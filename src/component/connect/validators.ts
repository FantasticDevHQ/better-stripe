import { type Infer, v } from "convex/values";

import { feeRoutingFields, splitRecipientRoleValidator } from "../lib/fees";

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
/**
 * Derived refund state denormalized onto a `payments` row so consumers can
 * answer "is this payment still whole?" in a single document read. The
 * authoritative per-refund records live in the `refunds` table.
 */
export const paymentRefundStatusValidator = v.union(
  v.literal("partially_refunded"),
  v.literal("fully_refunded"),
);
export type PaymentRefundStatus = Infer<typeof paymentRefundStatusValidator>;

export const paymentFields = {
  stripePaymentIntentId: v.string(),
  userId: v.string(),
  orgId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  status: paymentStatusValidator,
  // Cumulative refunded amount (cents) across all non-failed refunds for this PI.
  refundedAmount: v.optional(v.number()),
  // Derived flag; undefined when nothing has been refunded.
  refundStatus: v.optional(paymentRefundStatusValidator),
  ...feeRoutingFields,
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

// =============================================================================
// REFUNDS
// =============================================================================

/**
 * Refund status. The Stripe SDK types `Refund.status` as `string | null`, so we
 * enumerate from the documented values (`Refunds.d.ts`):
 * `pending | requires_action | succeeded | failed | canceled`.
 */
export const refundStatusValidator = v.union(
  v.literal("pending"),
  v.literal("requires_action"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);
export type RefundStatus = Infer<typeof refundStatusValidator>;

/** Refund reason — from the `Refund.Reason` SDK type alias. */
export const refundReasonValidator = v.union(
  v.literal("duplicate"),
  v.literal("fraudulent"),
  v.literal("requested_by_customer"),
  v.literal("expired_uncaptured_charge"),
);
export type RefundReason = Infer<typeof refundReasonValidator>;

/**
 * Field validators for the `refunds` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const refundFields = {
  stripeRefundId: v.string(),
  // Link key to the `payments` row. Optional only for the legacy charge-only
  // flow (pre-PaymentIntents); current integrations always carry it.
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  status: refundStatusValidator,
  reason: v.optional(refundReasonValidator),
  failureReason: v.optional(v.string()),
  metadata: v.optional(v.any()),
};

/** Full `refunds` document, including system fields. */
export const refundDocValidator = v.object({
  _id: v.id("refunds"),
  _creationTime: v.number(),
  ...refundFields,
});

// =============================================================================
// DISPUTES
// =============================================================================

/** Dispute status — from the `Dispute.Status` SDK type alias. */
export const disputeStatusValidator = v.union(
  v.literal("warning_needs_response"),
  v.literal("warning_under_review"),
  v.literal("warning_closed"),
  v.literal("needs_response"),
  v.literal("under_review"),
  v.literal("won"),
  v.literal("lost"),
  v.literal("prevented"),
);
export type DisputeStatus = Infer<typeof disputeStatusValidator>;

/**
 * Field validators for the `disputes` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const disputeFields = {
  stripeDisputeId: v.string(),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  status: disputeStatusValidator,
  // `Dispute.reason` is typed `string` (no union) in the SDK; current documented
  // values include duplicate, fraudulent, product_not_received, etc.
  reason: v.string(),
  isChargeRefundable: v.boolean(),
  // The most recent `charge.dispute.*` event that wrote this row (e.g.
  // "funds_withdrawn", "funds_reinstated", "closed"). Lets apps react to the
  // specific financial event without inferring it from booleans.
  lastEvent: v.optional(v.string()),
  metadata: v.optional(v.any()),
};

/** Full `disputes` document, including system fields. */
export const disputeDocValidator = v.object({
  _id: v.id("disputes"),
  _creationTime: v.number(),
  ...disputeFields,
});

// =============================================================================
// TRANSFERS (ledger — BTS-12)
// =============================================================================

/**
 * Lifecycle of a single `Transfer` (separate charges & transfers). Stripe
 * transfers settle immediately, so the interesting state is reversal.
 */
export const transferStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("reversed"),
);
export type TransferStatus = Infer<typeof transferStatusValidator>;

/** Denormalized reversal state, mirroring the payment refund-status pattern. */
export const transferReversalStatusValidator = v.union(
  v.literal("partially_reversed"),
  v.literal("fully_reversed"),
);
export type TransferReversalStatus = Infer<
  typeof transferReversalStatusValidator
>;

/**
 * Field validators for the `transfers` ledger table. One row per Stripe
 * `Transfer` so payout/earnings/reversal are a single read.
 */
export const transferFields = {
  stripeTransferId: v.string(),
  // The charge/invoice this transfer was funded from (`source_transaction`).
  sourceChargeId: v.optional(v.string()),
  sourceInvoiceId: v.optional(v.string()),
  destinationAccountId: v.string(),
  amount: v.number(),
  currency: v.string(),
  // store | affiliate | other — which leg of the split this is.
  role: v.optional(splitRecipientRoleValidator),
  status: transferStatusValidator,
  // Cumulative reversed amount (minor units) and derived flag.
  reversedAmount: v.optional(v.number()),
  reversalStatus: v.optional(transferReversalStatusValidator),
  // Link to the `payments` row that originated this transfer.
  paymentId: v.optional(v.string()),
  metadata: v.optional(v.any()),
};

/** Full `transfers` document, including system fields. */
export const transferDocValidator = v.object({
  _id: v.id("transfers"),
  _creationTime: v.number(),
  ...transferFields,
});
