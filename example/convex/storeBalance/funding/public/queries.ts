import { v } from "convex/values";

import { query } from "../../../_generated/server";

export const state = query({
  args: { sellerId: v.id("users") },
  returns: v.object({
    enabled: v.boolean(),
    consentAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.sellerId))?.role !== "seller")
      throw new Error("Choose a seller to manage payment sources.");
    const setting = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    return {
      enabled: setting?.enabled ?? false,
      consentAt: setting?.consentAt,
    };
  },
});
