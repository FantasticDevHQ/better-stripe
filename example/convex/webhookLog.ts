import { v } from 'convex/values';

import { internalMutation, query } from './_generated/server';

export const list = query({
  args: {
    eventType: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('processed'),
        v.literal('failed'),
        v.literal('ignored'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query('webhookLog')
      .withIndex('by_timestamp')
      .order('desc');

    const results = await q.collect();

    return results.filter((event) => {
      if (args.eventType && event.eventType !== args.eventType) return false;
      if (args.status && event.status !== args.status) return false;
      return true;
    });
  },
});

export const insert = internalMutation({
  args: {
    eventType: v.string(),
    stripeEventId: v.string(),
    status: v.union(
      v.literal('processed'),
      v.literal('failed'),
      v.literal('ignored'),
    ),
    payload: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('webhookLog', {
      ...args,
      timestamp: Date.now(),
    });
  },
});
