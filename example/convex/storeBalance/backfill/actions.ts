import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { runDoc } from "./validators";
/** Execute at most ten read/import/receipt reconciliations. Invoke again to resume. */
export const step = internalAction({
  args: { runId: v.id("storeBalanceMigrationRuns") },
  returns: runDoc,
  handler: async (ctx, args): Promise<typeof runDoc.type> => {
    const run = await ctx.runMutation(
      internal.storeBalance.backfill.mutations.reserve,
      args,
    );
    if (run.state !== "running" || !run.page) return run;
    for (const fundingId of run.page.ids) {
      const row = await ctx.runQuery(
        internal.storeBalance.backfill.queries.row,
        { fundingId },
      );
      if (!row) throw new Error("Legacy row disappeared during migration.");
      try {
        await ctx.runAction(
          internal.storeBalance.funding.internal.migrateActions.migrateSeller,
          { sellerId: row.sellerId },
        );
      } catch {
        // Keep original source and provider identifiers. The checkpoint counts this as held.
      }
    }
    return ctx.runMutation(
      internal.storeBalance.backfill.mutations.checkpoint,
      { runId: run._id, cursor: run.cursor },
    );
  },
});
