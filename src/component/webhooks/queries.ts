import { v } from 'convex/values';

import { query } from '../_generated/server';

/**
 * Check if a Stripe event has already been processed.
 * Returns the existing ledger entry if found, null otherwise.
 */
export const getWebhookEvent = query({
  args: { stripeEventId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('webhookEvents')
      .withIndex('by_stripeEventId', (q) =>
        q.eq('stripeEventId', args.stripeEventId),
      )
      .first();
  },
});
