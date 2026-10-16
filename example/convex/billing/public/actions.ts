import {
  checkoutArgsValidator,
  checkoutResult,
  createStoreCheckout,
} from "../../storefront/checkout";

import { v } from "convex/values";

import { action } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

import { assertSubscriptionOwner } from "../../users/authorization";

import { trialEndFromDateInput } from "../subscriptionLifecycle";

export const createBillingPortalSession = action({
  args: {
    stripeAccountId: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => stripe.createBillingPortalSession(ctx, args),
});

// Payment Methods
export const listPaymentMethods = action({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPaymentMethods(ctx, {
      stripeCustomerId: args.stripeCustomerId,
      type: "card",
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

export const createCheckoutSession = action({
  args: checkoutArgsValidator,
  returns: checkoutResult,
  handler: createStoreCheckout,
});

// Subscriptions
export const cancelSubscription = action({
  args: { userId: v.string(), stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.cancelSubscription(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
      cancelAtPeriodEnd: true,
    });
  },
});

export const reactivateSubscription = action({
  args: { userId: v.string(), stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.reactivateSubscription(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
    });
  },
});

export const pauseSubscription = action({
  args: {
    userId: v.string(),
    stripeSubscriptionId: v.string(),
    behavior: v.optional(
      v.union(
        v.literal("keep_as_draft"),
        v.literal("mark_uncollectible"),
        v.literal("void"),
      ),
    ),
    resumesAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.pauseSubscription(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
      behavior: args.behavior,
      resumesAt: args.resumesAt,
    });
  },
});

export const resumeSubscription = action({
  args: { userId: v.string(), stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.resumeSubscription(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
    });
  },
});

export const updateSubscriptionQuantity = action({
  args: {
    userId: v.string(),
    stripeSubscriptionId: v.string(),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.updateSubscriptionQuantity(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
      quantity: args.quantity,
    });
  },
});

export const updateSubscriptionPrice = action({
  args: {
    userId: v.string(),
    stripeSubscriptionId: v.string(),
    stripePriceId: v.string(),
    prorationBehavior: v.optional(
      v.union(
        v.literal("always_invoice"),
        v.literal("create_prorations"),
        v.literal("none"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.updateSubscriptionPrice(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
      stripePriceId: args.stripePriceId,
      prorationBehavior: args.prorationBehavior,
    });
  },
});

export const updateSubscriptionTrialEnd = action({
  args: {
    userId: v.string(),
    stripeSubscriptionId: v.string(),
    trialEnd: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await assertSubscriptionOwner(ctx, args);
    return stripe.updateSubscriptionTrialEnd(ctx, {
      stripeSubscriptionId: identity.stripeSubscriptionId,
      trialEnd: trialEndFromDateInput(args.trialEnd),
    });
  },
});
