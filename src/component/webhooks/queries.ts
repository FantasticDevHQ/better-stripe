import { v } from "convex/values";

import { query } from "../_generated/server";

/**
 * Check if a Stripe event has already been processed.
 * Returns the existing ledger entry if found, null otherwise.
 */
export const getWebhookEvent = query({
  args: { stripeEventId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();
  },
});

/**
 * List webhook events, most recent first.
 * Supports optional filtering by event type and status.
 */
export const listWebhookEvents = query({
  args: {
    eventType: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    const all = await ctx.db.query("webhookEvents").order("desc").take(limit);

    return all.filter((event) => {
      if (args.eventType && event.eventType !== args.eventType) return false;
      if (args.status && event.status !== args.status) return false;
      return true;
    });
  },
});
