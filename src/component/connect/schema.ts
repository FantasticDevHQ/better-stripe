import { defineTable } from "convex/server";

import {
  disputeFields,
  paymentFields,
  pendingFeeRefundFields,
  payoutFields,
  refundFields,
  transferFields,
  transferPersistedFields,
  transferReversalOpFields,
} from "./validators";

/**
 * Payment intents.
 */
export const paymentsTable = defineTable(paymentFields)
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_user_id", ["userId"])
  .index("by_account_id", ["accountId"]);

/**
 * Payouts to V2 accounts (marketplace).
 */
export const payoutsTable = defineTable(payoutFields)
  .index("by_stripe_payout_id", ["stripePayoutId"])
  .index("by_account_id", ["accountId"])
  .index("by_status", ["status"])
  .index("by_account_status", ["accountId", "status"]);

/**
 * Fee-refund facts parked when `application_fee.refunded` outruns the
 * `payment_intent.succeeded` that creates the linked `payments` row
 * (BTS-103). One row per payment intent; consumed and deleted by
 * `upsertPayment`'s insert branch.
 */
export const pendingFeeRefundsTable = defineTable(
  pendingFeeRefundFields,
).index("by_stripe_payment_intent_id", ["stripePaymentIntentId"]);

/**
 * Refunds. Compound status indexes follow Plan 002: filtered list queries
 * use a compound index, never filter-after-take.
 */
export const refundsTable = defineTable(refundFields)
  .index("by_stripe_refund_id", ["stripeRefundId"])
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_account_id", ["accountId"])
  .index("by_status", ["status"])
  .index("by_account_id_and_status", ["accountId", "status"])
  .index("by_payment_intent_id_and_status", [
    "stripePaymentIntentId",
    "status",
  ]);

/**
 * Transfers ledger (BTS-12). One row per Stripe `Transfer` for the separate
 * charges & transfers (split) flow, so earnings/payout/reversal are one read.
 */
export const transfersTable = defineTable({
  ...transferFields,
  ...transferPersistedFields,
})
  .index("by_stripe_transfer_id", ["stripeTransferId"])
  .index("by_destination_account_id", ["destinationAccountId"])
  .index("by_source_charge_id", ["sourceChargeId"]);

/**
 * Reversal operation claims (BTS-63): one row per dispute/refund clawback
 * operation, recording the exact slices it reserved so at-least-once webhook
 * delivery replays byte-identical Stripe requests instead of recomputing
 * amounts from mutable ledger state.
 */
export const transferReversalOpsTable = defineTable(
  transferReversalOpFields,
).index("by_operation_id", ["operationId"]);

/**
 * Disputes (chargebacks). Same indexing strategy as refunds.
 */
export const disputesTable = defineTable(disputeFields)
  .index("by_stripe_dispute_id", ["stripeDisputeId"])
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_account_id", ["accountId"])
  .index("by_status", ["status"])
  .index("by_account_id_and_status", ["accountId", "status"])
  .index("by_payment_intent_id_and_status", [
    "stripePaymentIntentId",
    "status",
  ]);
