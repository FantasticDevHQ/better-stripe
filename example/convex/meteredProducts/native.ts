import { v } from "convex/values";
import { action, env, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { stripe } from "../stripe/helpers";
import { getStripeClient } from "../stripe/client";
import {
  nativeDemoConfiguration,
  parseDemoConfiguration,
} from "../meteredUsage/policy";
import { assertBasePrice } from "./policy";
import { enrollmentRef } from "./schema";
import type { UsagePriceBinding } from "@fantastic.dev/better-stripe";
import type { UsageConfigurationValue } from "@fantastic.dev/better-stripe/usage";
export type ProductProvider = {
  issuer: string;
  configuration: UsageConfigurationValue;
  price: UsagePriceBinding;
  basePriceId: string | null;
};
export type ProductPayer = { accountId: string; customerId: string };
export async function originalEnrollment(
  ctx: ActionCtx,
  input: {
    actorId: Id<"users">;
    enrollmentId: Id<"meteredProductEnrollments">;
  },
) {
  const ref = { actorId: input.actorId, enrollmentId: input.enrollmentId };
  const enrollment: Doc<"meteredProductEnrollments"> = await ctx.runQuery(
    internal.meteredProducts.enrollments.read,
    ref,
  );
  const offer: Doc<"meteredProductOffers"> = await ctx.runQuery(
    internal.meteredProducts.catalog.read,
    { actorId: ref.actorId, offerId: enrollment.offerId },
  );
  if (!offer.providerJson || !enrollment.payerJson)
    throw new Error("Complete the original product checkout first.");
  const provider = JSON.parse(offer.providerJson) as ProductProvider;
  const payer = JSON.parse(enrollment.payerJson) as ProductPayer;
  return { enrollment, offer, provider, payer };
}
export function subscriptionRef(
  provider: ProductProvider,
  payer: ProductPayer,
  enrollmentId: string,
) {
  return {
    scope: {
      stripeAccountId: provider.issuer,
      customerAccount: payer.accountId,
      livemode: false,
    },
    requestId: `product_${enrollmentId}`,
  };
}
export const configure = action({
  args: {
    actorId: v.id("users"),
    productId: v.string(),
    baseAmount: v.number(),
    configurationJson: v.string(),
  },
  returns: v.id("meteredProductOffers"),
  handler: async (ctx, args): Promise<Id<"meteredProductOffers">> => {
    const offerId = await ctx.runMutation(
      internal.meteredProducts.catalog.prepare,
      args,
    );
    const offer = await ctx.runQuery(internal.meteredProducts.catalog.read, {
      actorId: args.actorId,
      offerId,
    });
    if (offer.providerJson) return offerId;
    const configuration = nativeDemoConfiguration(
      parseDemoConfiguration(
        offer.configurationJson,
        JSON.parse(offer.configurationJson).plan.model,
      ),
      offerId,
    );
    const raw = getStripeClient();
    const realm = await raw.accounts.retrieve(null);
    const product = await raw.products.retrieve(offer.productId);
    if ("deleted" in product || !product.active || product.livemode)
      throw new Error("The original test product is unavailable.");
    const scope = { stripeAccountId: realm.id, livemode: false };
    const meter = await stripe.ensureUsageMeter(ctx, {
      scope,
      plan: configuration.plan,
      eventName: configuration.eventName,
      displayName: configuration.displayName,
    });
    const price = await stripe.ensureUsagePrice(ctx, {
      scope,
      plan: configuration.plan,
      meterId: meter.id,
      stripeProductId: offer.productId,
      lookupKey: `bs_product_${offerId}_usage`,
    });
    let basePriceId: string | null = null;
    if (offer.baseAmount > 0) {
      const base = await stripe.ensurePrice(ctx, {
        stripeProductId: offer.productId,
        unitAmount: offer.baseAmount,
        currency: configuration.plan.rate.currency,
        type: "recurring",
        interval: "month",
        intervalCount: 1,
        lookupKey: `bs_product_${offerId}_base`,
        idempotencyKey: `bs_product_${offerId}_base`,
      });
      basePriceId = base.stripePriceId;
      assertBasePrice(
        {
          productId: offer.productId,
          baseAmount: offer.baseAmount,
          currency: configuration.plan.rate.currency,
        },
        await raw.prices.retrieve(basePriceId),
      );
    }
    const provider: ProductProvider = {
      issuer: realm.id,
      configuration,
      price,
      basePriceId,
    };
    await ctx.runMutation(internal.meteredProducts.catalog.pin, {
      actorId: args.actorId,
      offerId,
      providerJson: JSON.stringify(provider),
    });
    return offerId;
  },
});
/** The server chooses the payer and immutable offer. The browser never supplies prices or allowances. */
export const checkout = action({
  args: { actorId: v.id("users"), offerId: v.id("meteredProductOffers") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const observedAt = Date.now();
    const enrollmentId = await ctx.runMutation(
      internal.meteredProducts.enrollments.prepare,
      args,
    );
    const ref = { actorId: args.actorId, enrollmentId };
    const enrollment = await ctx.runQuery(
      internal.meteredProducts.enrollments.read,
      ref,
    );
    const offer = await ctx.runQuery(
      internal.meteredProducts.catalog.read,
      args,
    );
    const provider = JSON.parse(offer.providerJson!) as ProductProvider;
    const owner = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
      actorId: offer.ownerId,
    });
    const raw = getStripeClient();
    if (owner.role === "seller") {
      const saved = enrollment.checkoutJson
        ? (JSON.parse(enrollment.checkoutJson) as { id: string })
        : null;
      const completed =
        saved &&
        (await raw.checkout.sessions.retrieve(saved.id)).status === "complete";
      if (!completed) {
        const policy = await ctx.runQuery(
          internal.storefront.internal.queries.checkoutParticipants,
          { sellerAccountId: owner.stripeAccountId },
        );
        if (policy.sellerId !== offer.ownerId)
          throw new Error("Original seller account ownership changed.");
        if (!enrollment.settlementPlanId)
          await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
            ...ref,
            settlementPlanId: policy.planId,
          });
      } else if (!enrollment.settlementPlanId) {
        // Reconcile cash already collected under original terms even if the store later lapses.
        const seller = await ctx.runQuery(
          internal.storePlans.billing.internal.queries.getSeller,
          { sellerId: offer.ownerId },
        );
        if (seller.storePlan)
          await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
            ...ref,
            settlementPlanId: seller.storePlan.planId,
          });
      }
    }
    const enabled = await ctx.runQuery(
      internal.meteredProducts.enrollments.canCheckout,
      ref,
    );
    if (!enabled) {
      const saved = enrollment.checkoutJson
        ? (JSON.parse(enrollment.checkoutJson) as { id: string })
        : null;
      if (
        !saved ||
        (await raw.checkout.sessions.retrieve(saved.id)).status !== "complete"
      )
        throw new Error(
          "Metered billing is disabled for new purchases in this store.",
        );
    }
    if (!enrollment.payerJson) {
      const buyer = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
        actorId: args.actorId,
      });
      const accountId = buyer.stripeAccountId;
      if (!accountId)
        throw new Error(
          "Complete the example's customer account setup before purchasing metered services.",
        );
      const account = await stripe.getAccountByStripeId(ctx, {
        stripeAccountId: accountId,
        requireUnique: true,
      });
      if (!account || account.userId !== buyer.id)
        throw new Error("Original customer account ownership is unavailable.");
      await stripe.addCustomerConfiguration(ctx, {
        stripeAccountId: accountId,
      });
      const customer = await raw.customers.retrieve(accountId);
      if (
        "deleted" in customer ||
        customer.livemode ||
        customer.customer_account !== accountId ||
        !customer.id.startsWith("cus_")
      )
        throw new Error("Original customer mapping is unavailable.");
      await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
        ...ref,
        payerJson: JSON.stringify({
          accountId,
          customerId: customer.id,
        } satisfies ProductPayer),
      });
    }
    const original = await originalEnrollment(ctx, ref);
    if (provider.basePriceId)
      assertBasePrice(
        {
          productId: offer.productId,
          baseAmount: offer.baseAmount,
          currency: provider.configuration.plan.rate.currency,
        },
        await raw.prices.retrieve(provider.basePriceId),
      );
    const scope = {
      stripeAccountId: provider.issuer,
      livemode: false,
      customerAccount: original.payer.accountId,
      meterId: provider.price.meterId,
    };
    const binding = {
      stripeCustomerId: original.payer.customerId,
      stripePriceId: provider.price.stripePriceId,
      eventName: provider.configuration.eventName,
      plan: provider.configuration.plan,
    };
    if (provider.configuration.plan.model === "prepaid") {
      if (enrollment.checkoutJson)
        throw new Error(
          "This original Checkout uses an unsupported prepaid collection policy. Retain its history and use a new invoice-collection enrollment.",
        );
      const subscription = await stripe.usage.ensureSubscription(
        ctx,
        {
          requestId: `product_${enrollmentId}`,
          meters: [{ scope, binding }],
          collection: { method: "send_invoice", daysUntilDue: 30 },
        },
        { stripeSecretKey: env.STRIPE_SECRET_KEY },
      );
      await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
        ...ref,
        providerJson: JSON.stringify(subscription),
        observedAt,
      });
      return JSON.stringify({
        enrollmentId,
        url: null,
        status: subscription.status,
      });
    }
    const origin =
      enrollment.returnOrigin ?? env.FRONTEND_URL ?? "http://localhost:5173";
    const result = await stripe.usage.ensureCheckout(
      ctx,
      {
        requestId: `product_${enrollmentId}`,
        meters: [{ scope, binding }],
        fixedPriceIds: provider.basePriceId ? [provider.basePriceId] : [],
        collection: {
          method: "checkout",
          successUrl: `${origin}/demo/metered-usage?enrollment=${enrollmentId}`,
          cancelUrl: `${origin}/demo/metered-usage?enrollment=${enrollmentId}`,
        },
      },
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
    await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
      ...ref,
      checkoutJson: JSON.stringify({
        id: result.checkoutId,
        status: result.status,
        url: result.url,
      }),
      ...(result.subscription
        ? { providerJson: JSON.stringify(result.subscription), observedAt }
        : {}),
    });
    return JSON.stringify({
      enrollmentId,
      url: result.url,
      status: result.status,
    });
  },
});
export async function observeEnrollment(
  ctx: ActionCtx,
  input: {
    actorId: Id<"users">;
    enrollmentId: Id<"meteredProductEnrollments">;
  },
) {
  const ref = { actorId: input.actorId, enrollmentId: input.enrollmentId };
  const observedAt = Date.now();
  const original = await originalEnrollment(ctx, ref);
  const subscription = await stripe.usage.observeSubscription(
    ctx,
    subscriptionRef(original.provider, original.payer, original.enrollment._id),
    { stripeSecretKey: env.STRIPE_SECRET_KEY },
  );
  if (subscription.status !== "active" || subscription.bindings.length !== 1)
    throw new Error("An active original subscription is required.");
  const period = subscription.bindings[0].subscription.period;
  const now = Math.floor(Date.now() / 1000);
  if (now < period.start || now >= period.end)
    throw new Error("The original billing period is not active.");
  await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
    ...ref,
    providerJson: JSON.stringify(subscription),
    observedAt,
  });
  return { ...original, subscription, meter: subscription.bindings[0] };
}
export const refresh = action({
  args: enrollmentRef,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const enrollment = await ctx.runQuery(
      internal.meteredProducts.enrollments.read,
      args,
    );
    // Paid Checkout enrollments re-observe their original session. Prepaid
    // enrollments use send_invoice and have no hosted Checkout to reconcile.
    if (!enrollment.providerJson || enrollment.checkoutJson)
      await ctx.runAction(api.meteredProducts.native.checkout, {
        actorId: args.actorId,
        offerId: enrollment.offerId,
      });
    const { subscription } = await observeEnrollment(ctx, args);
    return JSON.stringify({ status: subscription.status });
  },
});
export const cancelRenewal = action({
  args: enrollmentRef,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const observedAt = Date.now();
    const original = await originalEnrollment(ctx, args);
    await stripe.usage.setCancelAtPeriodEnd(
      ctx,
      {
        ...subscriptionRef(
          original.provider,
          original.payer,
          original.enrollment._id,
        ),
        operationId: `cancel_${original.enrollment._id}`,
        cancelAtPeriodEnd: true,
      },
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
    // A retried command can return its original receipt. Only a fresh read
    // may advance the enrollment's current subscription observation.
    const subscription = await stripe.usage.observeSubscription(
      ctx,
      subscriptionRef(
        original.provider,
        original.payer,
        original.enrollment._id,
      ),
      { stripeSecretKey: env.STRIPE_SECRET_KEY },
    );
    await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
      ...args,
      providerJson: JSON.stringify(subscription),
      observedAt,
    });
    return JSON.stringify({
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      status: subscription.status,
    });
  },
});
