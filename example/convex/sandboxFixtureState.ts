import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { FIXTURE_VERSION } from "./lib/sandboxFixturePlan";
const jobFields = {
  version: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  cursor: v.number(),
  total: v.number(),
  attempts: v.number(),
  updatedAt: v.number(),
  error: v.optional(v.string()),
};
const jobDoc = v.object({
  ...jobFields,
  _id: v.id("sandboxFixtureJobs"),
  _creationTime: v.number(),
});
export const status = query({
  args: {},
  returns: v.union(jobDoc, v.null()),
  handler: (ctx) =>
    ctx.db
      .query("sandboxFixtureJobs")
      .withIndex("by_version", (q) => q.eq("version", FIXTURE_VERSION))
      .first(),
});
export const getJob = internalQuery({
  args: { jobId: v.id("sandboxFixtureJobs") },
  returns: v.union(jobDoc, v.null()),
  handler: (ctx, args) => ctx.db.get("sandboxFixtureJobs", args.jobId),
});
export const begin = internalMutation({
  args: { total: v.number() },
  returns: v.union(
    v.object({ jobId: v.id("sandboxFixtureJobs"), cursor: v.number() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sandboxFixtureJobs")
      .withIndex("by_version", (q) => q.eq("version", FIXTURE_VERSION))
      .first();
    if (
      existing?.status === "complete" ||
      (existing?.status === "running" &&
        existing.updatedAt > Date.now() - 180000)
    )
      return null;
    if (existing) {
      await ctx.db.patch("sandboxFixtureJobs", existing._id, {
        status: "running",
        attempts: 0,
        updatedAt: Date.now(),
        error: undefined,
      });
      return { jobId: existing._id, cursor: existing.cursor };
    }
    const jobId = await ctx.db.insert("sandboxFixtureJobs", {
      version: FIXTURE_VERSION,
      status: "running",
      cursor: 0,
      total: args.total,
      attempts: 0,
      updatedAt: Date.now(),
    });
    return { jobId, cursor: 0 };
  },
});
export const advance = internalMutation({
  args: { jobId: v.id("sandboxFixtureJobs"), cursor: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("sandboxFixtureJobs", args.jobId);
    if (!job || job.status !== "running" || job.cursor !== args.cursor)
      return false;
    const cursor = job.cursor + 1;
    await ctx.db.patch("sandboxFixtureJobs", job._id, {
      cursor,
      status: cursor >= job.total ? "complete" : "running",
      attempts: 0,
      error: undefined,
      updatedAt: Date.now(),
    });
    return cursor < job.total;
  },
});
export const failure = internalMutation({
  args: {
    jobId: v.id("sandboxFixtureJobs"),
    cursor: v.number(),
    error: v.string(),
    retry: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("sandboxFixtureJobs", args.jobId);
    if (job && job.cursor === args.cursor && job.status === "running")
      await ctx.db.patch("sandboxFixtureJobs", job._id, {
        attempts: job.attempts + 1,
        error: args.error,
        status: args.retry ? "running" : "failed",
        updatedAt: Date.now(),
      });
    return null;
  },
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
export const saveResource = internalMutation({
  args: { key: v.string(), stripeId: v.string(), kind: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sandboxFixtureResources")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing && existing.stripeId !== args.stripeId)
      throw new Error(
        "A different Stripe resource already exists for this fixture.",
      );
    if (!existing) await ctx.db.insert("sandboxFixtureResources", args);
    return null;
  },
});
