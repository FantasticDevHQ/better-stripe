import { v } from "convex/values";

import { mutation } from "../_generated/server";

// =============================================================================
// WEBHOOK EVENT LEDGER
// =============================================================================

/**
 * How long a "processing" ledger row is trusted to be genuinely in flight.
 * Convex HTTP actions and scheduled work complete well within this window;
 * a row older than this means the original delivery died before marking the
 * event processed/failed, and the event would otherwise dedupe forever.
 * Stripe's retry schedule spans hours/days, so retries will arrive after it.
 */
const PROCESSING_STALE_MS = 10 * 60 * 1000; // 10 minutes

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
      const stale =
        existing.status === "processing" &&
        Date.now() - existing.processedAt > PROCESSING_STALE_MS;

      if (existing.status === "failed" || stale) {
        // failed: prior delivery rolled back — reprocess on retry.
        // stale processing: prior delivery died without marking the row —
        // without this branch the event would deduplicate forever.
        await ctx.db.patch("webhookEvents", existing._id, {
          status: "processing",
          processedAt: Date.now(),
        });
        return "inserted" as const;
      }
      // fresh "processing": another delivery is in flight right now, and
      // reprocessing concurrently would double-apply. If that attempt fails
      // it marks the row "failed" and the next retry takes the branch above.
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

// =============================================================================
// LEDGER RETENTION
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
/** Default age after which a terminal ledger row is pruned. */
export const DEFAULT_WEBHOOK_EVENT_RETENTION_MS = 30 * DAY_MS;
/**
 * The ledger is the replay guard and Stripe retries a delivery for up to
 * three days, so a row younger than this must never be pruned.
 */
export const MIN_WEBHOOK_EVENT_RETENTION_MS = 3 * DAY_MS;
const DEFAULT_PRUNE_LIMIT = 500;
const MAX_PRUNE_LIMIT = 1000;
const PRUNABLE_STATUSES = ["processed", "ignored", "failed"] as const;

/**
 * Delete one bounded batch of terminal (`processed`, `ignored`, `failed`)
 * ledger rows whose `processedAt` is older than the retention window.
 * `processing` rows are never deleted. Call again while `hasMore` is true.
 */
export const pruneWebhookEvents = mutation({
  args: {
    /** Retention window in milliseconds (default 30 days, minimum 3 days). */
    olderThanMs: v.optional(v.number()),
    /** Maximum rows deleted per call (default 500, clamped to 1..1000). */
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    const olderThanMs = args.olderThanMs ?? DEFAULT_WEBHOOK_EVENT_RETENTION_MS;
    if (!(olderThanMs >= MIN_WEBHOOK_EVENT_RETENTION_MS)) {
      throw new Error(
        `pruneWebhookEvents: olderThanMs must be at least ${MIN_WEBHOOK_EVENT_RETENTION_MS} ms (3 days). ` +
          "The webhook ledger is the replay guard and Stripe retries deliveries for up to three days.",
      );
    }
    const requested = Math.floor(args.limit ?? DEFAULT_PRUNE_LIMIT);
    const limit = Math.min(
      MAX_PRUNE_LIMIT,
      Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_PRUNE_LIMIT),
    );
    const cutoff = Date.now() - olderThanMs;

    let deleted = 0;
    let hasMore = false;
    for (const status of PRUNABLE_STATUSES) {
      // One extra row past the remaining budget reveals whether more remain.
      const rows = await ctx.db
        .query("webhookEvents")
        .withIndex("by_status_processedAt", (q) =>
          q.eq("status", status).lt("processedAt", cutoff),
        )
        .take(limit - deleted + 1);
      const batch = rows.slice(0, limit - deleted);
      for (const row of batch) await ctx.db.delete("webhookEvents", row._id);
      deleted += batch.length;
      if (rows.length > batch.length) {
        hasMore = true;
        break;
      }
    }
    return { deleted, hasMore };
  },
});
