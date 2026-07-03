import { v } from "convex/values";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";

// Webhook setup — creates both V1 (snapshot) and V2 (thin) event destinations
export const setupWebhooks = action({
  args: { siteUrl: v.string() },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;

    // 1. Ensure V1 snapshot destination exists (payments, subscriptions, etc.)
    const v1 = await stripe.setupEventDestination(ctx, {
      url: webhookUrl,
      eventPayload: "snapshot",
    });

    // 2. Ensure V2 thin destination exists (Connect account lifecycle)
    const v2 = await stripe.setupEventDestination(ctx, {
      url: webhookUrl,
      eventPayload: "thin",
    });

    return { v1, v2 };
  },
});

export const getWebhookStatus = action({
  args: { siteUrl: v.string() },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;
    const destinations = await stripe.listEventDestinations(ctx);

    const v1Match = destinations.find(
      (d) => d.url === webhookUrl && d.eventPayload === "snapshot",
    );
    const v2Match = destinations.find(
      (d) => d.url === webhookUrl && d.eventPayload === "thin",
    );

    return {
      v1: v1Match
        ? {
            id: v1Match.id,
            name: v1Match.name,
            status: v1Match.status,
            eventCount: v1Match.enabledEvents.length,
          }
        : null,
      v2: v2Match
        ? {
            id: v2Match.id,
            name: v2Match.name,
            status: v2Match.status,
            eventCount: v2Match.enabledEvents.length,
          }
        : null,
    };
  },
});

export const verifyWebhookEnvs = action({
  args: {},
  handler: async () => {
    return {
      v1: !!process.env.STRIPE_WEBHOOK_SECRET,
      v2: !!process.env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});

export const checkEnvVars = action({
  args: {},
  handler: async () => {
    return {
      stripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
      webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
      webhookSecretV2: !!process.env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});

// Setup — seed demo data
export const seedDemoData = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.seed.seedDb, {});
    await ctx.runAction(internal.seed.seedStripe, {});
  },
});

// Setup — sync from Stripe
export const syncProducts = action({
  args: {},
  handler: async (ctx) => stripe.syncAllProducts(ctx),
});

export const syncSubscriptions = action({
  args: {},
  handler: async (ctx) => stripe.syncAllSubscriptions(ctx),
});

export const syncAccounts = action({
  args: {},
  handler: async (ctx) => stripe.syncAllAccounts(ctx),
});

// Reset — clear all app + component data
export const resetAll = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.reset.clearAppDb, {});
    await ctx.runAction(internal.reset.clearStripeDb, {});
  },
});

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
    type: v.union(v.literal("one_time"), v.literal("recurring")),
    interval: v.optional(
      v.union(
        v.literal("month"),
        v.literal("year"),
        v.literal("week"),
        v.literal("day"),
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

// Checkout

/**
 * Checkout mode for a price (BTS-57): one-time prices check out in `payment`
 * mode, recurring in `subscription` mode. Unknown prices (not yet synced into
 * the component) keep the subscription default; Stripe validates the actual
 * price/mode pairing when the session is created.
 */
export function checkoutModeForPrice(
  price: { type: string } | null,
): "payment" | "subscription" {
  return price?.type === "one_time" ? "payment" : "subscription";
}

export const createCheckoutSession = action({
  args: {
    userId: v.string(),
    stripePriceId: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const price = await stripe.getPriceByStripeId(ctx, {
      stripePriceId: args.stripePriceId,
    });
    return stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: checkoutModeForPrice(price),
      returnUrl: args.returnUrl,
      uiMode: "embedded",
    });
  },
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
