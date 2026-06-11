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
    let productsQuery;

    if (args.accountId) {
      const accountId = args.accountId;
      productsQuery = ctx.db
        .query("products")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId));
    } else {
      productsQuery = ctx.db.query("products");
    }

    const products = await productsQuery.take(limit);

    if (args.active !== undefined) {
      return products.filter((p) => p.active === args.active);
    }
    return products;
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
    let pricesQuery;

    if (args.productId) {
      const productId = args.productId;
      pricesQuery = ctx.db
        .query("prices")
        .withIndex("by_product_id", (q) => q.eq("productId", productId));
    } else {
      pricesQuery = ctx.db.query("prices");
    }

    const prices = await pricesQuery.take(limit);

    if (args.active !== undefined) {
      return prices.filter((p) => p.active === args.active);
    }
    return prices;
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
