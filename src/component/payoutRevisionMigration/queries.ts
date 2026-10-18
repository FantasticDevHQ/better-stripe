import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { jobDoc, resultDoc } from "./schema.js";
export const get = query({
  args: { jobId: v.id("payoutRevisionMigrations") },
  returns: v.union(jobDoc, v.null()),
  handler: async (ctx, { jobId }) =>
    ctx.db.get("payoutRevisionMigrations", jobId),
});
export const results = query({
  args: {
    jobId: v.id("payoutRevisionMigrations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(resultDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, { jobId, paginationOpts }) => {
    if (
      !Number.isInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 100
    )
      throw new Error("Migration result page must contain 1 to 100 items.");
    return paginator(ctx.db, schema)
      .query("payoutRevisionMigrationResults")
      .withIndex("by_job_account", (q) => q.eq("jobId", jobId))
      .paginate({
        ...paginationOpts,
        maximumRowsRead: Math.min(paginationOpts.maximumRowsRead ?? 100, 100),
        maximumBytesRead: Math.min(
          paginationOpts.maximumBytesRead ?? 262144,
          262144,
        ),
      });
  },
});
