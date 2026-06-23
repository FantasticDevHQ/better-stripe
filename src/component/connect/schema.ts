import { defineTable } from "convex/server";

import {
  disputeFields,
  paymentFields,
  payoutFields,
  refundFields,
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
 * Refunds. Compound status indexes follow Plan 002: filtered list queries
 * use a compound index, never filter-after-take.
 */
export const refundsTable = defineTable(refundFields)
  .index("by_stripe_refund_id", ["stripeRefundId"])
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_account_id", ["accountId"])
  .index("by_account_id_and_status", ["accountId", "status"])
  .index("by_payment_intent_id_and_status", [
    "stripePaymentIntentId",
    "status",
  ]);

/**
 * Disputes (chargebacks). Same indexing strategy as refunds.
 */
export const disputesTable = defineTable(disputeFields)
  .index("by_stripe_dispute_id", ["stripeDisputeId"])
  .index("by_stripe_payment_intent_id", ["stripePaymentIntentId"])
  .index("by_account_id", ["accountId"])
  .index("by_account_id_and_status", ["accountId", "status"])
  .index("by_payment_intent_id_and_status", [
    "stripePaymentIntentId",
    "status",
  ]);
