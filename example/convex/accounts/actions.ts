import { v } from "convex/values";

import { action, env } from "../_generated/server";

import { stripe } from "../stripe/helpers";

import {
  assertAccountOwner,
  assertTestModeStripeKey,
} from "../users/authorization";

// Products
export const createSellerLoginLink = action({
  args: { userId: v.string(), stripeAccountId: v.string() },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await assertAccountOwner(ctx, args);
    try {
      return await stripe.createLoginLink(ctx, {
        stripeAccountId: args.stripeAccountId,
      });
    } catch {
      throw new Error(
        "Stripe dashboard access is unavailable for this account. Complete onboarding and ensure the account uses the Express dashboard.",
      );
    }
  },
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
