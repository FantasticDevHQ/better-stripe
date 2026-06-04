import type Stripe from "stripe";

import {
  type WebhookContext,
  componentRef,
  deriveTrialFields,
  epochToIso,
  extractIdentifiers,
} from "./helpers.js";

// =============================================================================
// EVENT PROCESSOR
// =============================================================================

export async function processEvent(
  whCtx: WebhookContext,
  event: Stripe.Event,
): Promise<void> {
  // Stripe guarantees the object type matches event.type, so these casts are safe.
  const obj = event.data.object;

  switch (event.type) {
    case "product.created":
    case "product.updated":
      await handleProductEvent(whCtx, obj as Stripe.Product);
      break;
    case "price.created":
    case "price.updated":
      await handlePriceEvent(whCtx, obj as Stripe.Price);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscriptionFromStripe(whCtx, obj as Stripe.Subscription);
      break;
    case "checkout.session.completed":
      await handleCheckoutEvent(whCtx, obj as Stripe.Checkout.Session);
      break;
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
      await upsertInvoiceFromStripe(whCtx, obj as Stripe.Invoice);
      break;
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      await upsertPaymentFromStripe(whCtx, obj as Stripe.PaymentIntent);
      break;
    case "payout.created":
    case "payout.updated":
    case "payout.paid":
    case "payout.failed":
      await handlePayoutEvent(whCtx, obj as Stripe.Payout);
      break;
    default:
      console.info(`[better-stripe] Unhandled event type: ${event.type}`);
  }
}

// =============================================================================
// PER-DOMAIN HANDLERS
// =============================================================================

// Connect products may include an `account` field not present in base SDK types
type ConnectProduct = Stripe.Product & { account?: string };

async function handleProductEvent(
  whCtx: WebhookContext,
  product: Stripe.Product,
): Promise<void> {
  const { ctx, component } = whCtx;
  const productAccount = (product as ConnectProduct).account;

  await ctx.runMutation(
    componentRef(component, "products/mutations/upsertProduct"),
    {
      stripeProductId: product.id,
      accountId:
        typeof productAccount === "string" ? productAccount : undefined,
      name: product.name,
      description: product.description ?? undefined,
      active: product.active,
      metadata: product.metadata ?? undefined,
    },
  );
}

async function handlePriceEvent(
  whCtx: WebhookContext,
  price: Stripe.Price,
): Promise<void> {
  const { ctx, component, stripe } = whCtx;
  const stripeProductId: string =
    typeof price.product === "string"
      ? price.product
      : (price.product?.id ?? "");

  let internalProduct = (await ctx.runQuery(
    componentRef(component, "products/queries/getProductByStripeId"),
    { stripeProductId },
  )) as { _id: string } | null;

  if (!internalProduct && stripeProductId) {
    try {
      const stripeProduct = await stripe.products.retrieve(stripeProductId);
      await ctx.runMutation(
        componentRef(component, "products/mutations/upsertProduct"),
        {
          stripeProductId: stripeProduct.id,
          name: stripeProduct.name,
          description: stripeProduct.description ?? undefined,
          active: stripeProduct.active,
          metadata: stripeProduct.metadata ?? undefined,
        },
      );
      internalProduct = (await ctx.runQuery(
        componentRef(component, "products/queries/getProductByStripeId"),
        { stripeProductId },
      )) as { _id: string } | null;
    } catch (err) {
      console.warn(
        `[better-stripe] Could not auto-create product ${stripeProductId}:`,
        err,
      );
    }
  }

  if (!internalProduct) {
    console.warn(
      `[better-stripe] Skipping price ${price.id}: product ${stripeProductId} not found`,
    );
    return;
  }

  await ctx.runMutation(
    componentRef(component, "products/mutations/upsertPrice"),
    {
      stripePriceId: price.id,
      productId: internalProduct._id as string,
      stripeProductId,
      nickname: price.nickname ?? undefined,
      unitAmount: price.unit_amount ?? 0,
      currency: price.currency,
      active: price.active,
      type: price.type,
      interval: price.recurring?.interval,
      intervalCount: price.recurring?.interval_count ?? undefined,
      metadata: price.metadata ?? undefined,
    },
  );
}

async function upsertSubscriptionFromStripe(
  whCtx: WebhookContext,
  subscription: Stripe.Subscription,
): Promise<void> {
  const { ctx, component } = whCtx;
  const { userId, orgId } = extractIdentifiers(
    subscription.metadata as Record<string, string> | null,
  );
  const trial = deriveTrialFields(subscription);

  const firstItem = subscription.items?.data?.[0];
  const priceId = firstItem?.price?.id ?? undefined;
  const periodStart = firstItem?.current_period_start ?? undefined;
  const periodEnd = firstItem?.current_period_end ?? undefined;

  const accountId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? undefined);

  await ctx.runMutation(
    componentRef(component, "billing/mutations/upsertSubscription"),
    {
      stripeSubscriptionId: subscription.id,
      accountId,
      userId,
      orgId,
      status: subscription.status,
      priceId,
      quantity: firstItem?.quantity ?? undefined,
      currentPeriodStart: epochToIso(periodStart),
      currentPeriodEnd: epochToIso(periodEnd),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: epochToIso(subscription.canceled_at),
      isTrialing: trial.isTrialing,
      trialStart: trial.trialStart,
      trialEnd: trial.trialEnd,
      metadata: subscription.metadata ?? undefined,
    },
  );
}

async function handleCheckoutEvent(
  whCtx: WebhookContext,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { ctx, component } = whCtx;
  const { userId, orgId } = extractIdentifiers(
    session.metadata as Record<string, string> | null,
  );

  const lineItems = session.line_items?.data;
  const priceId = lineItems?.[0]?.price?.id;

  let mergedMetadata: Record<string, string> | undefined =
    (session.metadata as Record<string, string> | undefined) ?? undefined;
  try {
    const existing = (await ctx.runQuery(
      componentRef(component, "billing/queries/getCheckoutSessionByStripeId"),
      { stripeSessionId: session.id },
    )) as { metadata?: Record<string, string> } | null;
    if (existing?.metadata) {
      mergedMetadata = {
        ...(existing.metadata ?? {}),
        ...(session.metadata ?? {}),
      };
    }
  } catch {
    // First time seeing this session
  }

  await ctx.runMutation(
    componentRef(component, "billing/mutations/upsertCheckoutSession"),
    {
      stripeSessionId: session.id,
      userId,
      orgId,
      accountId:
        typeof session.customer === "string"
          ? session.customer
          : (session.customer?.id ?? undefined),
      mode: (session.mode ?? "payment") as "payment" | "subscription" | "setup",
      status: (session.status ?? "open") as "open" | "complete" | "expired",
      clientSecret: session.client_secret ?? undefined,
      url: session.url ?? undefined,
      priceId,
      metadata: mergedMetadata,
    },
  );
}

async function upsertInvoiceFromStripe(
  whCtx: WebhookContext,
  invoice: Stripe.Invoice,
): Promise<void> {
  const { ctx, component } = whCtx;
  const { userId, orgId } = extractIdentifiers(
    invoice.metadata as Record<string, string> | null,
  );

  const parentSub = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof parentSub === "string" ? parentSub : (parentSub?.id ?? undefined);

  await ctx.runMutation(
    componentRef(component, "billing/mutations/upsertInvoice"),
    {
      stripeInvoiceId: invoice.id!,
      userId,
      orgId,
      accountId:
        typeof invoice.customer === "string"
          ? invoice.customer
          : (invoice.customer?.id ?? undefined),
      subscriptionId,
      status: invoice.status ?? "draft",
      currency: invoice.currency!,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
      invoicePdf: invoice.invoice_pdf ?? undefined,
      periodStart: epochToIso(invoice.period_start),
      periodEnd: epochToIso(invoice.period_end),
      metadata: invoice.metadata ?? undefined,
    },
  );
}

async function upsertPaymentFromStripe(
  whCtx: WebhookContext,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const { ctx, component } = whCtx;
  const { userId, orgId } = extractIdentifiers(
    paymentIntent.metadata as Record<string, string> | null,
  );

  const statusMap: Record<string, string> = {
    succeeded: "succeeded",
    canceled: "canceled",
    processing: "processing",
    requires_action: "requires_action",
    requires_confirmation: "requires_action",
    requires_payment_method: "requires_action",
    requires_capture: "requires_action",
  };
  const status = (statusMap[paymentIntent.status] ?? "failed") as
    | "succeeded"
    | "failed"
    | "canceled"
    | "processing"
    | "requires_action";

  await ctx.runMutation(
    componentRef(component, "connect/mutations/upsertPayment"),
    {
      stripePaymentIntentId: paymentIntent.id,
      userId,
      orgId,
      accountId:
        typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : (paymentIntent.customer?.id ?? undefined),
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status,
      metadata: paymentIntent.metadata ?? undefined,
    },
  );
}

async function handlePayoutEvent(
  whCtx: WebhookContext,
  payout: Stripe.Payout,
): Promise<void> {
  const { ctx, component } = whCtx;

  await ctx.runMutation(
    componentRef(component, "connect/mutations/upsertPayout"),
    {
      stripePayoutId: payout.id,
      accountId:
        typeof payout.destination === "string"
          ? payout.destination
          : (payout.destination?.id ?? ""),
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status as
        | "pending"
        | "paid"
        | "failed"
        | "canceled"
        | "in_transit",
      arrivalDate: epochToIso(payout.arrival_date),
      method: payout.method ?? undefined,
      metadata: payout.metadata ?? undefined,
    },
  );
}
