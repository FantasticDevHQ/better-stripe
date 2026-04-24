import { v } from "convex/values";

import { mutation } from "../_generated/server";

// =============================================================================
// WEBHOOK EVENT LEDGER
// =============================================================================

/**
 * Atomically check-and-insert a webhook event for deduplication.
 * Returns 'inserted' if new, or the existing status if already processed.
 */
export const insertWebhookEvent = mutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    livemode: v.optional(v.boolean()),
  },
  returns: v.union(
    v.literal("inserted"),
    v.literal("processing"),
    v.literal("processed"),
    v.literal("failed"),
    v.literal("ignored"),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();

    if (existing) {
      return existing.status;
    }

    await ctx.db.insert("webhookEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      livemode: args.livemode,
      processedAt: Date.now(),
      status: "processing",
    });
    return "inserted" as const;
  },
});

/**
 * Mark a webhook event as successfully processed.
 */
export const markWebhookEventProcessed = mutation({
  args: { stripeEventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("webhookEvents", existing._id, {
        status: "processed",
        processedAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * Mark a webhook event as failed.
 */
export const markWebhookEventFailed = mutation({
  args: {
    stripeEventId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("webhookEvents", existing._id, {
        status: "failed",
        lastError: args.error,
        processedAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * Mark a webhook event as ignored (unsupported event type).
 */
export const markWebhookEventIgnored = mutation({
  args: { stripeEventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("webhookEvents", existing._id, {
        status: "ignored",
        processedAt: Date.now(),
      });
    }
    return null;
  },
});
