import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

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
