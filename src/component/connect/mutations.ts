import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { paymentStatusValidator, payoutStatusValidator } from './validators';

// =============================================================================
// PAYMENT MUTATIONS
// =============================================================================

export const upsertPayment = mutation({
  args: {
    stripePaymentIntentId: v.string(),
    userId: v.string(),
    orgId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    status: paymentStatusValidator,
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('payments')
      .withIndex('by_stripe_payment_intent_id', (q) =>
        q.eq('stripePaymentIntentId', args.stripePaymentIntentId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('payments', args);
    }

    return null;
  },
});

// =============================================================================
// PAYOUT MUTATIONS
// =============================================================================

export const upsertPayout = mutation({
  args: {
    stripePayoutId: v.string(),
    accountId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: payoutStatusValidator,
    arrivalDate: v.optional(v.string()),
    method: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('payouts')
      .withIndex('by_stripe_payout_id', (q) =>
        q.eq('stripePayoutId', args.stripePayoutId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('payouts', args);
    }

    return null;
  },
});
