import { v } from 'convex/values';

import { query } from '../_generated/server';

// =============================================================================
// PAYOUT QUERIES
// =============================================================================

export const getPayout = query({
  args: { payoutId: v.id('payouts') },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.payoutId);
  },
});

export const listPayouts = query({
  args: {
    accountId: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId) {
      const accountId = args.accountId;
      const payouts = await ctx.db
        .query('payouts')
        .withIndex('by_account_id', (q) => q.eq('accountId', accountId))
        .take(limit);
      if (args.status) return payouts.filter((p) => p.status === args.status);
      return payouts;
    }

    if (args.status) {
      return await ctx.db
        .query('payouts')
        .withIndex('by_status', (q) => q.eq('status', args.status as any))
        .take(limit);
    }

    return await ctx.db.query('payouts').take(limit);
  },
});
