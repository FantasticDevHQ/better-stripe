import { mutation } from "../_generated/server.js";
import { v } from "convex/values";
import { source, observation } from "./helpers.js";
export const save = mutation({
  args: {
    sourceJson: v.string(),
    observationJson: v.string(),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.startedAt) ||
      args.startedAt < 0 ||
      args.startedAt > Date.now() + 300000
    )
      throw new Error("Invalid observation start time");
    const binding = await source(args.sourceJson),
      observationJson = observation(args.observationJson, binding.opts);
    const prior = await ctx.db
      .query("usageProviderObservations")
      .withIndex("by_key", (q) => q.eq("key", binding.key))
      .unique();
    if (prior && prior.sourceJson !== binding.sourceJson)
      throw new Error("Usage observation binding conflict");
    if (prior && prior.startedAt > args.startedAt) return null;
    const fields = {
      key: binding.key,
      scopeKey: binding.scopeKey,
      sourceJson: binding.sourceJson,
      observationJson,
      startedAt: args.startedAt,
    };
    if (prior)
      await ctx.db.patch("usageProviderObservations", prior._id, fields);
    else await ctx.db.insert("usageProviderObservations", fields);
    return null;
  },
});
