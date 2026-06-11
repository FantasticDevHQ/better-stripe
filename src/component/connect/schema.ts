import { defineTable } from "convex/server";

import { paymentFields, payoutFields } from "./validators";

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
  .index("by_status", ["status"]);
