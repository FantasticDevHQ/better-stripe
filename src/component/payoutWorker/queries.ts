import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { policyDoc } from "../payoutPolicy/schema.js";
import { readJob, pageSize } from "./helpers.js";
import { jobDoc, scope } from "./schema.js";
export const get = query({
  args: scope,
  returns: v.union(jobDoc, v.null()),
  handler: readJob,
});
export const policies = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(policyDoc),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    pageSize(args.paginationOpts.numItems);
    const p = await paginator(ctx.db, schema)
      .query("payoutPolicies")
      .withIndex("by_mode_status", (q) =>
        q.eq("mode", "custom").eq("status", "ready"),
      )
      .paginate(args.paginationOpts);
    return { page: p.page, continueCursor: p.continueCursor, isDone: p.isDone };
  },
});
export const changing = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(policyDoc),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    pageSize(args.paginationOpts.numItems);
    const p = await paginator(ctx.db, schema)
      .query("payoutPolicies")
      .withIndex("by_status", (q) => q.eq("status", "changing"))
      .paginate(args.paginationOpts);
    return { page: p.page, continueCursor: p.continueCursor, isDone: p.isDone };
  },
});
/** Includes attempted jobs after opt-out. It is not restricted to custom policies. */
export const recovering = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(jobDoc),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    pageSize(args.paginationOpts.numItems);
    const p = await paginator(ctx.db, schema)
      .query("payoutWorkerJobs")
      .withIndex("by_operation_pending", (q) =>
        q.eq("hasOperation", true).lte("nextAttemptAt", Date.now()),
      )
      .paginate(args.paginationOpts);
    return { page: p.page, continueCursor: p.continueCursor, isDone: p.isDone };
  },
});
