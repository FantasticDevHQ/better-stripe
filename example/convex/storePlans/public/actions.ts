import { v } from "convex/values";

import {
  prepareBillingPortalSessionRequestIdentity,
  type CreateBillingPortalSessionOptions,
} from "@fantastic.dev/better-stripe";
import type { Id } from "../../_generated/dataModel";
import type { StorePlanId } from "../helpers";
import { action, env, type ActionCtx } from "../../_generated/server";

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

const manageArgs = {
  sellerId: v.id("users"),
  returnUrl: v.string(),
  targetPlanId: v.optional(storePlanIdValidator),
};
const requestIdentity = v.object({ key: v.string(), binding: v.string() });

// This persona demo must be replaced with authenticated principal authorization in production.
// Preparation is read-only. A lost preparation response must never create a provider resource.
async function manageOptions(
  ctx: ActionCtx,
  args: {
    sellerId: Id<"users">;
    returnUrl: string;
    targetPlanId?: StorePlanId;
  },
): Promise<Omit<CreateBillingPortalSessionOptions, "requestIdentity">> {
  const seller = await ctx.runQuery(
    internal.storePlans.billing.internal.queries.getSeller,
    { sellerId: args.sellerId },
  );
  if (!seller.stripeAccountId || !seller.storePlan)
    throw new Error("Choose a store plan first.");
  const returnUrl = new URL(
    "/seller/plan",
    env.FRONTEND_URL ?? "http://localhost:5173",
  ).href;
  if (
    args.returnUrl !== returnUrl ||
    (args.targetPlanId !== undefined && !hasPaidStorePlan(seller.storePlan))
  )
    throw new Error(
      "Review an active plan from the configured seller billing page.",
    );
  const configurationId = env.STORE_PLAN_PORTAL_CONFIGURATION_ID;
  if (!configurationId)
    throw new Error(
      "Configure STORE_PLAN_PORTAL_CONFIGURATION_ID before opening billing.",
    );
  const catalog = await ctx.runQuery(
    internal.storePlans.billing.internal.queries.readCatalog,
    {},
  );
  const target =
    args.targetPlanId === undefined
      ? undefined
      : catalog.find((p) => p.planId === args.targetPlanId);
  if (
    args.targetPlanId !== undefined &&
    (!target ||
      catalog.filter((p) => p.planId === args.targetPlanId).length !== 1)
  )
    throw new Error(
      "The requested plan is not available in the server catalog.",
    );
  const subscription = await getStripeClient().subscriptions.retrieve(
    seller.storePlan.stripeSubscriptionId,
    {},
    { maxNetworkRetries: 0 },
  );
  if (
    subscription.id !== seller.storePlan.stripeSubscriptionId ||
    subscription.customer_account !== seller.stripeAccountId ||
    subscription.items.has_more !== false ||
    subscription.items.data.length !== 1 ||
    !subscription.items.data[0]?.id
  )
    throw new Error(
      "This original subscription cannot use a portal confirmation.",
    );
  const configuration = await stripe.retrieveBillingPortalConfiguration(ctx, {
    configurationId,
  });
  const updates = configuration.features.subscription_update;
  if (
    configuration.id !== configurationId ||
    !configuration.active ||
    (target &&
      (!updates.enabled ||
        !updates.default_allowed_updates.includes("price") ||
        updates.proration_behavior !== "always_invoice" ||
        (updates.schedule_at_period_end?.conditions.length ?? 0) !== 0 ||
        !updates.products?.some(
          (p) =>
            p.product === target.stripeProductId &&
            p.prices.includes(target.stripePriceId),
        )))
  )
    throw new Error(
      "The configured portal policy does not allow this plan confirmation.",
    );
  return {
    stripeAccountId: seller.stripeAccountId,
    configurationId,
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
  };
}

export const prepareManage = action({
  args: { ...manageArgs, key: v.string() },
  returns: requestIdentity,
  handler: async (ctx, args) =>
    prepareBillingPortalSessionRequestIdentity(
      await manageOptions(ctx, args),
      args.key,
    ),
});

export const manage = action({
  args: { ...manageArgs, requestIdentity: v.optional(requestIdentity) },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const options = await manageOptions(ctx, args);
    const portal = await stripe.createBillingPortalSession(ctx, {
      ...options,
      ...(args.requestIdentity
        ? { requestIdentity: args.requestIdentity }
        : {}),
    });
    return portal.url;
  },
});
