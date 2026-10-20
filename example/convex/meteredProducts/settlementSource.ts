import {
  throwFinancialOutcome,
  type SettlementResult,
} from "@fantastic.dev/better-stripe";
import type {
  UsageInvoiceSaleOptions,
  UsageSubscriptionView,
} from "@fantastic.dev/better-stripe/usage";
import { api, components, internal } from "../_generated/api";
import { env, type ActionCtx } from "../_generated/server";
import { stripe } from "../stripe/helpers";
import { getStripeClient } from "../stripe/client";
import { originalEnrollment } from "./native";
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
export type UsageSource = NonNullable<SettlementResult["usageSource"]>;
const pending = () =>
  throwFinancialOutcome({
    status: "not_ready",
    reason: "provider_pending",
    retryable: true,
  });
/** Metadata only locates a managed intent; original Checkout, payer, offer and native lines authorize it. */
export async function meteredSaleSource(
  ctx: ActionCtx,
  args: {
    paymentIntentId: string;
    invoiceId?: string;
    subscriptionId?: string;
  },
) {
  const raw = getStripeClient();
  if (
    args.subscriptionId &&
    !(await raw.subscriptions.retrieve(args.subscriptionId)).metadata
      .bsUsageIntent
  )
    return undefined;
  const inverse = await raw.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: args.paymentIntentId },
    limit: 100,
  });
  if (inverse.has_more)
    throw new Error("Original invoice funding history is incomplete.");
  const paid = inverse.data.filter((row) => row.status === "paid");
  if (!paid.length) return undefined;
  if (paid.length !== 1)
    throw new Error("Original payment funds multiple invoices.");
  const invoiceId = id(paid[0].invoice)!;
  const invoice = await raw.invoices.retrieve(invoiceId);
  const subscriptionId = id(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return undefined;
  const sub = await raw.subscriptions.retrieve(subscriptionId);
  const key = sub.metadata.bsUsageIntent;
  if (!key) return undefined;
  const intent = await ctx.runQuery(
    components.betterStripe.usageSubscriptions.queries.lookup,
    { key },
  );
  if (!intent?.checkoutId) return null;
  const enrollment = await ctx.runQuery(
    internal.meteredProducts.enrollments.forCheckout,
    { checkoutId: intent.checkoutId },
  );
  if (!enrollment) return null;
  const ref = { actorId: enrollment.buyerId, enrollmentId: enrollment._id };
  const original = await originalEnrollment(ctx, ref);
  const buyer = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
    actorId: enrollment.buyerId,
  });
  const payerMapping = await stripe.getAccountByStripeId(ctx, {
    stripeAccountId: original.payer.accountId,
    requireUnique: true,
  });
  if (
    buyer.stripeAccountId !== original.payer.accountId ||
    payerMapping?.userId !== enrollment.buyerId
  )
    throw new Error("Original buyer account ownership changed.");
  const expected = await ctx.runQuery(
    components.betterStripe.usageSubscriptions.queries.get,
    {
      scope: {
        stripeAccountId: original.provider.issuer,
        customerAccount: original.payer.accountId,
        livemode: false,
      },
      requestId: `product_${enrollment._id}`,
    },
  );
  if (
    expected?.key !== key ||
    (intent.providerId && intent.providerId !== subscriptionId) ||
    (args.invoiceId && args.invoiceId !== invoiceId) ||
    (args.subscriptionId && args.subscriptionId !== subscriptionId)
  )
    throw new Error("Original metered sale identity changed.");
  const session = await raw.checkout.sessions.retrieve(intent.checkoutId);
  if (session.status !== "complete") return pending();
  if (
    id(session.subscription) !== subscriptionId ||
    session.customer_account !== original.payer.accountId ||
    session.livemode
  )
    throw new Error("Original Checkout ownership changed.");
  if (!enrollment.providerJson) {
    await ctx.runAction(api.meteredProducts.native.checkout, {
      actorId: enrollment.buyerId,
      offerId: enrollment.offerId,
    });
    return pending();
  }
  const view = JSON.parse(enrollment.providerJson) as UsageSubscriptionView;
  const meter = view.bindings[0];
  if (
    view.subscriptionId !== subscriptionId ||
    view.bindings.length !== 1 ||
    original.provider.configuration.plan.model === "prepaid"
  )
    throw new Error("Unsupported original metered sale.");
  const owner = await ctx.runQuery(internal.meteredProducts.catalog.actor, {
    actorId: original.offer.ownerId,
  });
  // Issuer services retain their proceeds; only original seller-owned products create transfers.
  if (owner.role === "admin") return null;
  const identity = await stripe.getProductIdentity(ctx, {
    stripeProductId: original.offer.productId,
  });
  if (
    owner.role !== "seller" ||
    !owner.stripeAccountId ||
    identity.status !== "unique" ||
    identity.product.accountId !== owner.stripeAccountId
  )
    throw new Error("Original seller product ownership changed.");
  const base =
    original.provider.basePriceId &&
    view.items.find(
      (item) => item.stripePriceId === original.provider.basePriceId,
    );
  const input: UsageInvoiceSaleOptions = {
    ...meter,
    period: meter.subscription.period,
    invoiceId,
    paymentIntentId: args.paymentIntentId,
    gross: invoice.amount_paid,
    ...(base
      ? {
          fixedPrice: {
            stripePriceId: base.stripePriceId,
            subscriptionItemId: base.id,
            unitAmount: original.offer.baseAmount,
          },
        }
      : {}),
  };
  if (original.provider.basePriceId && !base)
    throw new Error("Original monthly item is unavailable.");
  const proof = await stripe.usage.getInvoiceSale(ctx, input, {
    stripeSecretKey: env.STRIPE_SECRET_KEY,
  });
  if (proof.status !== "ready") {
    throwFinancialOutcome(proof);
  }
  const source = proof.value;
  if (
    source.stripeProductId !== original.offer.productId ||
    source.stripePriceId !== original.provider.price.stripePriceId ||
    source.meterId !== original.provider.price.meterId ||
    source.subscriptionItemId !== meter.subscription.subscriptionItemId ||
    source.subscriptionId !== subscriptionId ||
    source.invoiceId !== invoiceId ||
    source.customerAccountId !== original.payer.accountId ||
    source.stripeAccountId !== original.provider.issuer ||
    source.livemode
  )
    throw new Error(
      "Original product and verified invoice provenance disagree.",
    );
  const usageSource: UsageSource = {
    stripeAccountId: source.stripeAccountId,
    customerAccount: source.customerAccountId,
    livemode: source.livemode,
    meterId: source.meterId,
    stripePriceId: source.stripePriceId,
    stripeProductId: source.stripeProductId,
    subscriptionId,
    subscriptionItemId: source.subscriptionItemId,
    invoicePaymentId: source.invoicePaymentId,
    period: source.period,
    model: source.model,
    ...(source.invoiceLines ? { invoiceLines: source.invoiceLines } : {}),
  };
  return {
    input,
    usageSource,
    enrollmentId: enrollment._id,
    verified: {
      ...source,
      status: "ready" as const,
      metadata: {
        storeBilling: "sale_v1",
        ...(enrollment.settlementPlanId
          ? { planId: enrollment.settlementPlanId }
          : {}),
        sellerId: owner.id,
        userId: enrollment.buyerId,
        stripeProductId: original.offer.productId,
      } as Record<string, string>,
    },
  };
}
