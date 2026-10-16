import { v } from "convex/values";

import { query } from "../_generated/server";

import { platformPayout, state, storePayout } from "./helpers";

export const get = query({
  args: { sellerId: v.optional(v.id("users")) },
  returns: state,
  handler: async (ctx, args) => {
    if (!args.sellerId) return platformPayout(ctx);
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller") throw new Error("Choose a seller.");
    return storePayout(ctx, seller);
  },
});
