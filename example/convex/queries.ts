import { v } from 'convex/values';

import { query } from './_generated/server';
import { stripe } from './stripe';

// Accounts
export const getAccountByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => stripe.getAccountByUserId(ctx, args),
});

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

// Subscriptions
export const listSubscriptions = query({
  args: {},
  handler: async (ctx) => stripe.listSubscriptions(ctx),
});

export const listSubscriptionsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    stripe.listSubscriptionsByUser(ctx, { userId: args.userId }),
});

// Invoices
export const listInvoices = query({
  args: {},
  handler: async (ctx) => stripe.listInvoices(ctx),
});

export const listInvoicesByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) =>
    stripe.listInvoices(ctx, { userId: args.userId }),
});

// Payouts
export const listPayouts = query({
  args: {},
  handler: async (ctx) => stripe.listPayouts(ctx),
});

// Checkout Sessions
export const getCheckoutSessionByStripeId = query({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, args) =>
    stripe.getCheckoutSessionByStripeId(ctx, {
      stripeSessionId: args.stripeSessionId,
    }),
});

// Config
export const getPublishableKey = query({
  args: {},
  handler: async (ctx) => stripe.getPublishableKey(ctx),
});

export const getStripeMode = query({
  args: {},
  handler: async (ctx) => stripe.getStripeMode(ctx),
});
