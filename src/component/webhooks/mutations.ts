import { v } from "convex/values";

import { mutation } from "../_generated/server";

// =============================================================================
// WEBHOOK EVENT LEDGER
// =============================================================================

/**
 * Atomically check-and-insert a webhook event for deduplication.
 * Returns 'inserted' if new (or if a prior attempt failed and the event
 * should be reprocessed), or the existing status when deduplicating.
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
      if (existing.status === "failed") {
        // A previous delivery failed and its writes rolled back, so the
        // event was never applied. Stripe is retrying — reset the row to
        // in-flight and tell the handler to reprocess. Without this, failed
        // events would deduplicate forever and be permanently dropped.
        await ctx.db.patch("webhookEvents", existing._id, {
          status: "processing",
          processedAt: Date.now(),
        });
        return "inserted" as const;
      }
      // "processing" keeps deduplicating: it means another delivery of this
      // event is in flight right now, and reprocessing concurrently would
      // double-apply. If that attempt fails it marks the row "failed" and
      // the next retry takes the branch above.
      // "processed" and "ignored" are terminal — always deduplicate.
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
