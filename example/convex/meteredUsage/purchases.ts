import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { demoRun } from "./authorization";
import { parseDemoConfiguration } from "./policy";
import { demoPurchaseFields } from "./schema";
const ref = { actorId: v.id("users"), runId: v.id("meteredDemoRuns") };
const doc = v.object({
  _id: v.id("meteredDemoPurchases"),
  _creationTime: v.number(),
  ...demoPurchaseFields,
});
export const prepare = internalMutation({
  args: { ...ref, requestId: v.string() },
  returns: doc,
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (run.model !== "prepaid" || run.archived)
      throw new Error("An active prepaid sandbox run is required.");
    if (!/^[\w.-]{1,100}$/.test(args.requestId))
      throw new Error("Invalid purchase identity.");
    const saved = await ctx.db
      .query("meteredDemoPurchases")
      .withIndex("by_run_request", (q) =>
        q.eq("runId", run._id).eq("requestId", args.requestId),
      )
      .unique();
    if (saved) return saved;
    if (run.billingStartedAt !== undefined)
      throw new Error("The original billing period is closing.");
    const existing = await ctx.db
      .query("meteredDemoPurchases")
      .withIndex("by_run_request", (q) => q.eq("runId", run._id))
      .take(21);
    if (existing.length >= 20)
      throw new Error("The sandbox purchase-intent budget is exhausted.");
    const config = parseDemoConfiguration(run.configurationJson, run.model);
    const id = await ctx.db.insert("meteredDemoPurchases", {
      runId: run._id,
      requestId: args.requestId,
      quantity: config.creditPackage!.quantity,
      createdAt: Date.now(),
    });
    await ctx.db.patch("meteredDemoRuns", run._id, { lastPurchaseId: id });
    return (await ctx.db.get("meteredDemoPurchases", id))!;
  },
});
export const latest = internalQuery({
  args: ref,
  returns: v.union(doc, v.null()),
  handler: async (ctx, args) => {
    const run = await demoRun(ctx, args.actorId, args.runId);
    if (!run.lastPurchaseId) return null;
    const row = await ctx.db.get("meteredDemoPurchases", run.lastPurchaseId);
    return row?.runId === run._id ? row : null;
  },
});

export const list = internalQuery({
  args: ref,
  returns: v.array(doc),
  handler: async (ctx, args) => {
    await demoRun(ctx, args.actorId, args.runId);
    const rows = await ctx.db
      .query("meteredDemoPurchases")
      .withIndex("by_run_request", (q) => q.eq("runId", args.runId))
      .take(21);
    if (rows.length > 20)
      throw new Error("Complete purchase history is required.");
    return rows;
  },
});
