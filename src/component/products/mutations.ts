import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { priceIntervalValidator, priceTypeValidator } from "./validators";

// =============================================================================
// PRODUCT MUTATIONS
// =============================================================================

export const upsertProduct = mutation({
  args: {
    stripeProductId: v.string(),
    accountId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    active: v.boolean(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("products")
      .withIndex("by_stripe_product_id", (q) =>
        q.eq("stripeProductId", args.stripeProductId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("products", existing._id, args);
    } else {
      await ctx.db.insert("products", args);
    }

    return null;
  },
});

// =============================================================================
// PRICE MUTATIONS
// =============================================================================

export const upsertPrice = mutation({
  args: {
    stripePriceId: v.string(),
    productId: v.string(),
    stripeProductId: v.string(),
    nickname: v.optional(v.string()),
    unitAmount: v.number(),
    currency: v.string(),
    active: v.boolean(),
    type: priceTypeValidator,
    interval: priceIntervalValidator,
    intervalCount: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("prices")
      .withIndex("by_stripe_price_id", (q) =>
        q.eq("stripePriceId", args.stripePriceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("prices", existing._id, args);
    } else {
      await ctx.db.insert("prices", args);
    }

    return null;
  },
});
