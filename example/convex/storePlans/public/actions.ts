import { v } from "convex/values";

import { action, env } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { stripe } from "../../stripe/helpers";

import { getStripeClient } from "../../stripe/client";

import { hasPaidStorePlan } from "../helpers";

import { storePlanIdValidator } from "../validators";

export const createCheckout = action({
  args: {
    sellerId: v.id("users"),
    planId: storePlanIdValidator,
    returnUrl: v.string(),
  },
  returns: v.object({
    clientSecret: v.optional(v.string()),
    stripeSessionId: v.string(),
    url: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    clientSecret?: string;
    stripeSessionId: string;
    url?: string;
  }> => {
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      {
        sellerId: args.sellerId,
      },
    );
    if (!seller.stripeAccountId)
      throw new Error("Complete seller onboarding before subscribing.");
    if (hasPaidStorePlan(seller.storePlan))
      throw new Error("Manage your existing store plan to change tiers.");
    const raw = getStripeClient();
    await stripe.addCustomerConfiguration(ctx, {
      stripeAccountId: seller.stripeAccountId,
    });
    // Stripe is authoritative even when a webhook has not arrived yet.
    const existing = await raw.subscriptions.list({
      customer_account: seller.stripeAccountId,
      status: "all",
      limit: 100,
    });
    if (
      existing.data.some(
        (s) =>
          s.metadata.storeBilling === "plan_v1" &&
          s.status !== "canceled" &&
          s.status !== "incomplete_expired",
      )
    )
      throw new Error(
        "A store subscription already exists. Use Manage plan to update it.",
      );
    const catalog = await ctx.runAction(
      internal.storePlans.internal.actions.ensureCatalog,
      {},
    );
    const price = catalog.find((p) => p.planId === args.planId)!;
    return stripe.createCheckoutSession(ctx, {
      userId: seller.sellerId,
      accountId: seller.stripeAccountId,
      stripePriceId: price.stripePriceId,
      mode: "subscription",
      uiMode: "embedded",
      returnUrl: args.returnUrl,
      metadata: {
        storeBilling: "plan_v1",
        sellerId: seller.sellerId,
        planId: args.planId,
      },
      sessionOverrides: { adaptive_pricing: { enabled: false } },
    });
  },
});

export const confirmCheckout = action({
  args: { sellerId: v.id("users"), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.storePlans.billing.internal.queries.getSeller, {
      sellerId: args.sellerId,
    });
    const session = await getStripeClient().checkout.sessions.retrieve(
      args.sessionId,
    );
    if (
      session.metadata?.storeBilling !== "plan_v1" ||
      session.metadata.sellerId !== args.sellerId ||
      session.payment_status !== "paid" ||
      !session.subscription
    )
      throw new Error("This store plan payment has not completed.");
    await ctx.runAction(
      internal.storePlans.internal.actions.refreshSubscription,
      {
        subscriptionId:
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id,
      },
    );
    return null;
  },
});

export const manage = action({
  args: {
    sellerId: v.id("users"),
    returnUrl: v.string(),
    targetPlanId: v.optional(storePlanIdValidator),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      {
        sellerId: args.sellerId,
      },
    );
    if (!seller.stripeAccountId || !seller.storePlan)
      throw new Error("Choose a store plan first.");
    // Demo persona binding, not authentication: targets come only from the server catalog.
    const targetRequested = args.targetPlanId !== undefined;
    const returnUrl = targetRequested
      ? new URL("/seller/plan", env.FRONTEND_URL ?? "http://localhost:5173")
          .href
      : args.returnUrl;
    if (
      targetRequested &&
      (!hasPaidStorePlan(seller.storePlan) || args.returnUrl !== returnUrl)
    )
      throw new Error(
        "Review an active plan from the configured seller billing page.",
      );
    const catalog = targetRequested
      ? await ctx.runQuery(
          internal.storePlans.billing.internal.queries.readCatalog,
          {},
        )
      : await ctx.runAction(
          internal.storePlans.internal.actions.ensureCatalog,
          {},
        );
    const target = targetRequested
      ? catalog.find((entry) => entry.planId === args.targetPlanId)
      : undefined;
    if (
      targetRequested &&
      (!target ||
        catalog.filter((entry) => entry.planId === args.targetPlanId).length !==
          1)
    )
      throw new Error(
        "The requested plan is not available in the server catalog.",
      );
    const raw = getStripeClient();
    const products = [...new Set(catalog.map((p) => p.stripeProductId))].map(
      (product) => ({
        product,
        prices: catalog
          .filter((p) => p.stripeProductId === product)
          .map((p) => p.stripePriceId),
      }),
    );
    // Retain the current v1 price in the portal while existing test subscriptions
    // migrate naturally when the seller chooses a different tier.
    const subscription = await raw.subscriptions.retrieve(
      seller.storePlan.stripeSubscriptionId,
    );
    // Verify the saved original resource before creating a provider configuration.
    if (
      targetRequested &&
      (subscription.id !== seller.storePlan.stripeSubscriptionId ||
        subscription.customer_account !== seller.stripeAccountId ||
        subscription.items.has_more !== false ||
        subscription.items.data.length !== 1 ||
        !subscription.items.data[0]?.id)
    )
      throw new Error(
        "This original subscription cannot use a targeted portal confirmation.",
      );
    const currentPrice = subscription.items.data[0]?.price;
    const currentProduct =
      currentPrice &&
      (typeof currentPrice.product === "string"
        ? currentPrice.product
        : currentPrice.product.id);
    if (currentPrice && currentProduct) {
      const existingProduct = products.find(
        (product) => product.product === currentProduct,
      );
      if (existingProduct) {
        if (!existingProduct.prices.includes(currentPrice.id))
          existingProduct.prices.push(currentPrice.id);
      } else
        products.push({ product: currentProduct, prices: [currentPrice.id] });
    }
    const configuration = await stripe.createBillingPortalConfiguration(ctx, {
      params: {
        business_profile: { headline: "Manage your BetterStripe store plan" },
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
          subscription_update: {
            enabled: true,
            default_allowed_updates: ["price"],
            products,
            proration_behavior: "always_invoice",
            schedule_at_period_end: { conditions: [] },
          },
        },
      },
    });
    const portal = await stripe.createBillingPortalSession(ctx, {
      stripeAccountId: seller.stripeAccountId,
      returnUrl,
      ...(target
        ? {
            flowData: {
              type: "subscription_update_confirm" as const,
              subscription_update_confirm: {
                subscription: seller.storePlan.stripeSubscriptionId,
                items: [
                  {
                    id: subscription.items.data[0]!.id,
                    price: target.stripePriceId,
                  },
                ] as [{ id: string; price: string }],
              },
              after_completion: {
                type: "redirect" as const,
                redirect: { return_url: returnUrl },
              },
            },
          }
        : {}),
      configurationId: configuration.id,
    });
    return portal.url;
  },
});
