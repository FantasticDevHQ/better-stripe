import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";
import { getStripeClient } from "./lib/stripeClient";
import {
  STORE_PLANS,
  hasPaidStorePlan,
  storePlanLookupKey,
  type StorePlanId,
} from "./lib/storePlans";
import { storePlanIdValidator } from "./lib/storePlanValidators";
import type { Id } from "./_generated/dataModel";

export const ensureCatalog = internalAction({
  args: {},
  returns: v.array(
    v.object({
      planId: storePlanIdValidator,
      stripeProductId: v.string(),
      stripePriceId: v.string(),
    }),
  ),
  handler: async (
    ctx,
  ): Promise<
    { planId: StorePlanId; stripeProductId: string; stripePriceId: string }[]
  > => {
    const raw = getStripeClient();
    const cached = await ctx.runQuery(
      internal.storePlanBilling.readCatalog,
      {},
    );
    // Each monthly tier is a separate product so Stripe's portal can offer
    // all three without duplicate intervals on a single product.
    const distinct =
      new Set(cached.map((p) => p.stripeProductId)).size === cached.length;
    const result = distinct ? [...cached] : [];
    if (result.length === STORE_PLANS.length) return result;
    for (const plan of STORE_PLANS) {
      if (result.some((p) => p.planId === plan.id)) continue;
      const key = storePlanLookupKey(plan.id);
      const found = await raw.prices.list({ lookup_keys: [key], limit: 1 });
      let price = found.data[0];
      if (!price) {
        const product = await raw.products.create(
          {
            name: `BetterStripe ${plan.name} store plan`,
            metadata: { storeBilling: "plan_v1" },
          },
          { idempotencyKey: `example_store_plan_product_${plan.id}_v2` },
        );
        price = await raw.prices.create(
          {
            product: product.id,
            currency: "usd",
            unit_amount: plan.monthlyAmount,
            recurring: { interval: "month" },
            lookup_key: key,
            nickname: plan.name,
            metadata: { storePlanId: plan.id },
          },
          { idempotencyKey: key },
        );
      }
      const entry = {
        planId: plan.id,
        stripeProductId:
          typeof price.product === "string" ? price.product : price.product.id,
        stripePriceId: price.id,
      };
      await ctx.runMutation(internal.storePlanBilling.saveCatalogPrice, entry);
      result.push(entry);
    }
    return result;
  },
});
export const refreshSubscription = internalAction({
  args: { subscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sub = await getStripeClient().subscriptions.retrieve(
      args.subscriptionId,
      { expand: ["latest_invoice"] },
    );
    if (sub.metadata.storeBilling !== "plan_v1") return null;
    const sellerId = sub.metadata.sellerId as Id<"users">;
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId,
    });
    const catalog = await ctx.runQuery(
      internal.storePlanBilling.readCatalog,
      {},
    );
    const item = sub.items.data[0];
    const planId =
      catalog.find((p) => p.stripePriceId === item?.price.id)?.planId ??
      STORE_PLANS.find(
        (p) =>
          item?.price.lookup_key ===
          storePlanLookupKey(p.id).replace("_v2", "_v1"),
      )?.id;
    if (!planId || sub.items.data.length !== 1 || item.quantity !== 1)
      throw new Error("Unrecognized store plan subscription.");
    const invoice = sub.latest_invoice;
    const paid =
      invoice && typeof invoice !== "string" && invoice.status === "paid";
    const active = sub.status === "active" && paid;
    // Pending prorations must never grant the new tier before payment.
    const previous = seller.storePlan;
    const billingNow = sub.test_clock
      ? (typeof sub.test_clock === "string"
          ? await getStripeClient().testHelpers.testClocks.retrieve(
              sub.test_clock,
            )
          : sub.test_clock
        ).frozen_time * 1000
      : Date.now();
    const preservePaidAccess =
      !!previous &&
      previous.stripeSubscriptionId === sub.id &&
      previous.paidThrough > billingNow &&
      ["active", "past_due"].includes(sub.status);
    await ctx.runMutation(internal.storePlanBilling.applyVerifiedSubscription, {
      sellerId,
      storePlan: {
        planId: active ? planId : (previous?.planId ?? planId),
        stripeSubscriptionId: sub.id,
        status:
          active || preservePaidAccess
            ? "active"
            : sub.status === "active"
              ? "unpaid"
              : sub.status,
        paidThrough: active
          ? item.current_period_end * 1000
          : (previous?.paidThrough ?? 0),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        lastInvoiceId: typeof invoice === "string" ? invoice : invoice?.id,
      },
    });
    return null;
  },
});
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
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId: args.sellerId,
    });
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
      internal.storePlanActions.ensureCatalog,
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
    await ctx.runQuery(internal.storePlanBilling.getSeller, {
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
    await ctx.runAction(internal.storePlanActions.refreshSubscription, {
      subscriptionId:
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id,
    });
    return null;
  },
});
export const manage = action({
  args: { sellerId: v.id("users"), returnUrl: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId: args.sellerId,
    });
    if (!seller.stripeAccountId || !seller.storePlan)
      throw new Error("Choose a store plan first.");
    const catalog = await ctx.runAction(
      internal.storePlanActions.ensureCatalog,
      {},
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
    const currentPrice = subscription.items.data[0]?.price;
    const currentProduct =
      currentPrice &&
      (typeof currentPrice.product === "string"
        ? currentPrice.product
        : currentPrice.product.id);
    if (
      currentPrice &&
      currentProduct &&
      !products.some((p) => p.product === currentProduct)
    )
      products.push({ product: currentProduct, prices: [currentPrice.id] });
    const configuration = await raw.billingPortal.configurations.create({
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
    });
    const portal = await raw.billingPortal.sessions.create({
      customer_account: seller.stripeAccountId,
      return_url: args.returnUrl,
      configuration: configuration.id,
    });
    return portal.url;
  },
});
