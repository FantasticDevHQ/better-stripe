import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { refundCommandBinding } from "./commandBinding.js";

/** Trusted-host projection backfill; completion covers current component rows, never provider history. */
export const normalizeRefundCommandBindings = mutation({
  args: { limit: v.number() },
  returns: v.object({ normalized: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, { limit }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Normalization limit must be an integer from 1 to 100");
    const rows = await ctx.db
      .query("refunds")
      .withIndex("by_refund_command_normalization_version", (q) =>
        q.eq("refundCommandNormalizationVersion", undefined),
      )
      .take(limit);
    const now = Date.now();
    for (const row of rows)
      await ctx.db.patch(
        "refunds",
        row._id,
        refundCommandBinding(row, {}, now),
      );
    const pending = await ctx.db
      .query("refunds")
      .withIndex("by_refund_command_normalization_version", (q) =>
        q.eq("refundCommandNormalizationVersion", undefined),
      )
      .take(1);
    return { normalized: rows.length, hasMore: pending.length > 0 };
  },
});
