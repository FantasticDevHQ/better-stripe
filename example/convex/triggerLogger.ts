import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Record a sync-trigger or async-hook invocation.
 *
 * Called from inside the trigger callbacks in stripe.ts. For sync triggers
 * this runs via ctx.runMutation INSIDE the dispatcher mutation — i.e. in the
 * SAME transaction as the component DB write — which is exactly what the E2E
 * webhook test asserts.
 */
export const record = internalMutation({
  args: {
    source: v.union(v.literal("trigger"), v.literal("hook")),
    kind: v.string(),
    stripeId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("triggerLog", args);
  },
});

/**
 * List recent trigger-log rows, optionally filtered. Newest first.
 * Internal — only the E2E test harness reads this (via `npx convex run`,
 * which can invoke internal functions on a dev deployment).
 */
export const listTriggerLog = internalQuery({
  args: {
    kind: v.optional(v.string()),
    source: v.optional(v.union(v.literal("trigger"), v.literal("hook"))),
    sinceCreationTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const kind = args.kind;
    const rows = kind
      ? await ctx.db
          .query("triggerLog")
          .withIndex("by_kind", (q) => q.eq("kind", kind))
          .order("desc")
          .take(500)
      : await ctx.db.query("triggerLog").order("desc").take(500);
    return rows.filter((row) => {
      if (args.source && row.source !== args.source) return false;
      if (
        args.sinceCreationTime !== undefined &&
        row._creationTime < args.sinceCreationTime
      ) {
        return false;
      }
      return true;
    });
  },
});

/** Delete all trigger-log rows (test reset). */
export const clearTriggerLog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("triggerLog").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
