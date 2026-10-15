import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { v } from "convex/values";
import { mutation } from "./triggers.js";
/** Call repeatedly until isDone. Updates and backfill share one transaction. */
export const backfillCurrencyTotals = mutation({
  args: {
    kind: v.union(v.literal("earnings"), v.literal("payouts")),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const table = args.kind === "earnings" ? "transfers" : "payouts";
    const result = await paginator(ctx.db, schema)
      .query(table)
      .paginate({ numItems: 100, cursor: args.cursor });
    for (const row of result.page)
      if (!row.totalsRecorded) await ctx.db.patch(table, row._id, {});
    return { isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
