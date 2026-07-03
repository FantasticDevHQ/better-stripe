import { v } from "convex/values";

import { query } from "./_generated/server";
import { stripe } from "./stripe";

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

export const listWebhookEvents = query({
  args: {
    eventType: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    stripe.listWebhookEvents(ctx, {
      eventType: args.eventType,
      status: args.status,
    }),
});

export const getSeedStatus = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return { userCount: users.length };
  },
});

// Marketplace / affiliate-split demo (BTS-43)

/**
 * Resolve the demo's store (Maya) and affiliate (Avery) personas by email —
 * their `acct_…` ids are minted at seed time, so the split demo looks them up
 * at query time rather than hard-coding. Either side is null until the seed has
 * linked its Stripe account.
 */
export const getMarketplacePersonas = query({
  args: {},
  handler: async (ctx) => {
    const byEmail = async (email: string) =>
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
    const store = await byEmail("maya@example.com");
    const affiliate = await byEmail("avery@example.com");
    return {
      store: store
        ? {
            userId: store._id,
            accountId: store.stripeAccountId ?? null,
            name: store.storeName ?? store.name,
          }
        : null,
      affiliate: affiliate
        ? {
            userId: affiliate._id,
            accountId: affiliate.stripeAccountId ?? null,
            name: affiliate.name,
          }
        : null,
    };
  },
});

/**
 * The original split legs of one sale (`listTransfersByCharge` excludes
 * reinstatement rows), for the `useSplitBreakdown` hook. Wraps the component
 * query.
 */
export const listTransfersByCharge = query({
  args: { sourceChargeId: v.string() },
  handler: async (ctx, args) =>
    stripe.listTransfersByCharge(ctx, { sourceChargeId: args.sourceChargeId }),
});

/**
 * A recipient's transfer ledger (the earnings view — includes reinstatements),
 * for the `useEarnings` hook. Wraps the component query.
 */
export const listTransfersByAccount = query({
  args: { destinationAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.listTransfersByAccount(ctx, {
      destinationAccountId: args.destinationAccountId,
    }),
});

/** A recipient's payouts, for the `useEarnings` hook (arg name `accountId`). */
export const listPayoutsByAccount = query({
  args: { accountId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPayouts(ctx, { stripeAccountId: args.accountId }),
});
