import { v } from "convex/values";

import { query } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

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

// Checkout Sessions
export const getCheckoutSessionByStripeId = query({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, args) =>
    stripe.getCheckoutSessionByStripeId(ctx, {
      stripeSessionId: args.stripeSessionId,
    }),
});
