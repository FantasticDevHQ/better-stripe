import { v } from "convex/values";

import { query } from "../_generated/server";

import { stripe } from "../stripe/helpers";

// Products & Prices
export const listProducts = query({
  args: {},
  handler: async (ctx) => stripe.listProducts(ctx),
});

export const listProductsWithPrices = query({
  args: {},
  handler: async (ctx) => {
    const products = await stripe.listProducts(ctx);
    return Promise.all(
      products.map(async (p) => ({
        ...p,
        prices: await stripe.listPricesByProduct(ctx, {
          stripeProductId: p.stripeProductId,
        }),
      })),
    );
  },
});

export const listProductsWithPricesByAccount = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    const products = await stripe.listProducts(ctx, {
      accountId: args.accountId,
    });
    return Promise.all(
      products.map(async (p) => ({
        ...p,
        prices: await stripe.listPricesByProduct(ctx, {
          stripeProductId: p.stripeProductId,
        }),
      })),
    );
  },
});

export const listPrices = query({
  args: {},
  handler: async (ctx) => stripe.listPrices(ctx),
});
