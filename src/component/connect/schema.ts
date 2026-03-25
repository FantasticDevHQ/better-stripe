import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { paymentStatusValidator, payoutStatusValidator } from './validators';

/**
 * Payment intents.
 */
export const paymentsTable = defineTable({
  stripePaymentIntentId: v.string(),
  userId: v.string(),
  orgId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  status: paymentStatusValidator,
  metadata: v.optional(v.any()),
})
  .index('by_stripe_payment_intent_id', ['stripePaymentIntentId'])
  .index('by_user_id', ['userId']);

/**
 * Payouts to V2 accounts (marketplace).
 */
export const payoutsTable = defineTable({
  stripePayoutId: v.string(),
  accountId: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: payoutStatusValidator,
  arrivalDate: v.optional(v.string()),
  method: v.optional(v.string()),
  metadata: v.optional(v.any()),
})
  .index('by_stripe_payout_id', ['stripePayoutId'])
  .index('by_account_id', ['accountId'])
  .index('by_status', ['status']);
