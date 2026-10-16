import { v } from "convex/values";

import { query } from "../../_generated/server";

import { storeSaleDocValidator } from "../../storePlans/validators";

export const listSellerSales = query({
  args: { sellerId: v.id("users") },
  returns: v.array(storeSaleDocValidator),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to view store sales.");
    return ctx.db
      .query("storeSales")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .order("desc")
      .take(100);
  },
});
