import { v } from "convex/values";

import { internalQuery } from "../../../_generated/server";

import { jobDoc } from "../helpers";

export const getJob = internalQuery({
  args: { jobId: v.id("sandboxFixtureJobs") },
  returns: v.union(jobDoc, v.null()),
  handler: (ctx, args) => ctx.db.get("sandboxFixtureJobs", args.jobId),
});

export const resource = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("sandboxFixtureResources")
        .withIndex("by_key", (q) => q.eq("key", args.key))
        .first()
    )?.stripeId ?? null,
});
