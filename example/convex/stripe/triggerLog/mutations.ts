import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

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

/** Delete all trigger-log rows (test reset). */
export const clearTriggerLog = internalMutation({
  args: {},
  handler: async (ctx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Internal test reset mutation, not a reactive query.
    const rows = await ctx.db.query("triggerLog").collect();
    for (const row of rows) {
      await ctx.db.delete("triggerLog", row._id);
    }
    return { deleted: rows.length };
  },
});
