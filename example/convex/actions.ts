import { v } from 'convex/values';

import { action } from './_generated/server';
import { stripe } from './stripe';

// Products
export const createProduct = action({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => stripe.createProduct(ctx, args),
});

export const createPrice = action({
  args: {
    stripeProductId: v.string(),
    unitAmount: v.number(),
    currency: v.string(),
    type: v.union(v.literal('one_time'), v.literal('recurring')),
    interval: v.optional(
      v.union(
        v.literal('month'),
        v.literal('year'),
        v.literal('week'),
        v.literal('day'),
      ),
    ),
  },
  handler: async (ctx, args) => stripe.createPrice(ctx, args),
});

export const createProductForAccount = action({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    accountId: v.string(),
  },
  handler: async (ctx, args) =>
    stripe.createProduct(ctx, {
      name: args.name,
      description: args.description,
      accountId: args.accountId,
    }),
});

// Accounts
export const createAccountWithOnboarding = action({
  args: {
    userId: v.string(),
    email: v.string(),
    country: v.string(),
    refreshUrl: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) =>
    stripe.createAccountWithOnboarding(ctx, {
      userId: args.userId,
      email: args.email,
      country: args.country,
      refreshUrl: args.refreshUrl,
      returnUrl: args.returnUrl,
    }),
});

export const restartAccountOnboarding = action({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.restartAccountOnboarding(ctx, {
      stripeAccountId: args.stripeAccountId,
    }),
});

export const getAccountLinkWithStatus = action({
  args: {
    stripeAccountId: v.string(),
    refreshUrl: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => stripe.getAccountLinkWithStatus(ctx, args),
});

// Payment Methods
export const listPaymentMethods = action({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPaymentMethods(ctx, {
      stripeCustomerId: args.stripeCustomerId,
      type: 'card',
    }),
});

export const attachPaymentMethod = action({
  args: { paymentMethodId: v.string(), stripeCustomerId: v.string() },
  handler: async (ctx, args) => stripe.attachPaymentMethod(ctx, args),
});

export const detachPaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, args) => stripe.detachPaymentMethod(ctx, args),
});

// Checkout
export const createCheckoutSession = action({
  args: {
    userId: v.string(),
    stripePriceId: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) =>
    stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: 'subscription',
      returnUrl: args.returnUrl,
      uiMode: 'embedded',
    }),
});

// Subscriptions
export const cancelSubscription = action({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) =>
    stripe.cancelSubscription(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      cancelAtPeriodEnd: true,
    }),
});
