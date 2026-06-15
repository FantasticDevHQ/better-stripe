import { v } from "convex/values";

import { query } from "../_generated/server";
import { priceDocValidator, productDocValidator } from "./validators";

// =============================================================================
// PRODUCT QUERIES
// =============================================================================

export const getProduct = query({
  args: { productId: v.id("products") },
  returns: v.union(productDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("products", args.productId);
  },
});

export const getProductByStripeId = query({
  args: { stripeProductId: v.string() },
  returns: v.union(productDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_stripe_product_id", (q) =>
        q.eq("stripeProductId", args.stripeProductId),
      )
      .first();
  },
});

export const listProducts = query({
  args: {
    accountId: v.optional(v.string()),
    active: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(productDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId !== undefined && args.active !== undefined) {
      const { accountId, active } = args;
      return await ctx.db
        .query("products")
        .withIndex("by_account_active", (q) =>
          q.eq("accountId", accountId).eq("active", active),
        )
        .take(limit);
    }

    if (args.accountId !== undefined) {
      const accountId = args.accountId;
      return await ctx.db
        .query("products")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
    }

    if (args.active !== undefined) {
      const active = args.active;
      return await ctx.db
        .query("products")
        .withIndex("by_active", (q) => q.eq("active", active))
        .take(limit);
    }

    return await ctx.db.query("products").take(limit);
  },
});

// =============================================================================
// PRICE QUERIES
// =============================================================================

export const getPrice = query({
  args: { priceId: v.id("prices") },
  returns: v.union(priceDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("prices", args.priceId);
  },
});

export const getPriceByStripeId = query({
  args: { stripePriceId: v.string() },
  returns: v.union(priceDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("prices")
      .withIndex("by_stripe_price_id", (q) =>
        q.eq("stripePriceId", args.stripePriceId),
      )
      .first();
  },
});

export const listPrices = query({
  args: {
    productId: v.optional(v.string()),
    active: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(priceDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.productId !== undefined && args.active !== undefined) {
      const { productId, active } = args;
      return await ctx.db
        .query("prices")
        .withIndex("by_product_active", (q) =>
          q.eq("productId", productId).eq("active", active),
        )
        .take(limit);
    }

    if (args.productId !== undefined) {
      const productId = args.productId;
      return await ctx.db
        .query("prices")
        .withIndex("by_product_id", (q) => q.eq("productId", productId))
        .take(limit);
    }

    if (args.active !== undefined) {
      const active = args.active;
      return await ctx.db
        .query("prices")
        .withIndex("by_active", (q) => q.eq("active", active))
        .take(limit);
    }

    return await ctx.db.query("prices").take(limit);
  },
});

export const listPricesByProduct = query({
  args: { stripeProductId: v.string() },
  returns: v.array(priceDocValidator),
  handler: async (ctx, args) => {
    // A product typically has a small, bounded number of prices.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    return await ctx.db
      .query("prices")
      .withIndex("by_stripe_product_id", (q) =>
        q.eq("stripeProductId", args.stripeProductId),
      )
      .collect();
  },
});
