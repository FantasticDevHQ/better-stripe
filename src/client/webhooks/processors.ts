import type Stripe from "stripe";

import type { SplitRecipient } from "../../component/lib/fees.js";
import { createSplitTransfers } from "../connect/transfers.js";
import { computeFee } from "../core/fees.js";
import type { PlatformFeeConfig } from "../types.js";
import { resolveOwnerAccount } from "../utils/owner.js";
import {
  type WebhookContext,
  componentRef,
  deriveTrialFields,
  dispatchUpsert,
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
    case "customer.subscription.trial_will_end":
      await upsertSubscriptionFromStripe(
        whCtx,
        obj as Stripe.Subscription,
        "subscriptionUpserted",
      );
      break;
    case "customer.subscription.deleted":
      await upsertSubscriptionFromStripe(
        whCtx,
        obj as Stripe.Subscription,
        "subscriptionDeleted",
      );
      break;
    case "checkout.session.completed":
      await handleCheckoutEvent(whCtx, obj as Stripe.Checkout.Session);
      break;
    case "invoice.created":
      // Apply a per-invoice fixed/tier platform fee before finalization, then
      // record the invoice. Percent-only fees use application_fee_percent on the
      // subscription and don't need this.
      await applyPerInvoiceFee(whCtx, obj as Stripe.Invoice);
      await upsertInvoiceFromStripe(whCtx, obj as Stripe.Invoice);
      break;
    case "invoice.paid":
      await upsertInvoiceFromStripe(whCtx, obj as Stripe.Invoice);
      // Fan funds to split recipients each billing cycle for a separate-charges
      // subscription (BTS-52).
      await handleInvoiceSplitTransfers(whCtx, obj as Stripe.Invoice);
      break;
    case "invoice.finalized":
    case "invoice.payment_failed":
      await upsertInvoiceFromStripe(whCtx, obj as Stripe.Invoice);
      break;
    case "payment_intent.succeeded":
      await upsertPaymentFromStripe(whCtx, obj as Stripe.PaymentIntent);
      // Fan funds out to split recipients for a separate-charges sale.
      await handleSplitTransfers(whCtx, obj as Stripe.PaymentIntent);
      break;
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
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      await handleRefundEvent(whCtx, obj as Stripe.Refund);
      break;
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated":
      await handleDisputeEvent(
        whCtx,
        obj as Stripe.Dispute,
        event.type.replace("charge.dispute.", ""),
      );
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
  const productAccount = (product as ConnectProduct).account;

  await dispatchUpsert(whCtx, "productUpserted", {
    stripeProductId: product.id,
    accountId: typeof productAccount === "string" ? productAccount : undefined,
    name: product.name,
    description: product.description ?? undefined,
    active: product.active,
    metadata: product.metadata ?? undefined,
  });
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

  await dispatchUpsert(whCtx, "priceUpserted", {
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
  });
}

async function upsertSubscriptionFromStripe(
  whCtx: WebhookContext,
  subscription: Stripe.Subscription,
  dispatcherName: "subscriptionUpserted" | "subscriptionDeleted",
): Promise<void> {
  const { userId, orgId } = extractIdentifiers(
    subscription.metadata as Record<string, string> | null,
  );
  const trial = deriveTrialFields(subscription);

  const firstItem = subscription.items?.data?.[0];
  const priceId = firstItem?.price?.id ?? undefined;
  const periodStart = firstItem?.current_period_start ?? undefined;
  const periodEnd = firstItem?.current_period_end ?? undefined;

  // Prefer the V2 `customer_account` (acct_…) over the legacy `customer`
  // (cus_…) so V2 customer-configured accounts are attributed correctly.
  const accountId = resolveOwnerAccount(subscription) ?? undefined;

  await dispatchUpsert(whCtx, dispatcherName, {
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
  });
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

  await dispatchUpsert(whCtx, "checkoutSessionUpserted", {
    stripeSessionId: session.id,
    userId,
    orgId,
    accountId: resolveOwnerAccount(session) ?? undefined,
    mode: (session.mode ?? "payment") as "payment" | "subscription" | "setup",
    status: (session.status ?? "open") as "open" | "complete" | "expired",
    clientSecret: session.client_secret ?? undefined,
    url: session.url ?? undefined,
    priceId,
    metadata: mergedMetadata,
  });
}

/**
 * Fee/transfer fields (BTS-11) captured off a PaymentIntent for denormalization
 * onto the `payments` row. Returns `{}` when the charge carried no fee/transfer.
 */
function feeRoutingFromPaymentIntent(pi: Stripe.PaymentIntent): {
  chargeType?: "destination";
  destinationAccountId?: string;
  applicationFeeAmount?: number;
  feeCollectedAmount?: number;
} {
  const dest = pi.transfer_data?.destination;
  const destinationAccountId = typeof dest === "string" ? dest : dest?.id;
  const fee = pi.application_fee_amount ?? undefined;
  if (!destinationAccountId && fee === undefined) return {};
  return {
    chargeType: "destination",
    ...(destinationAccountId ? { destinationAccountId } : {}),
    ...(fee !== undefined
      ? { applicationFeeAmount: fee, feeCollectedAmount: fee }
      : {}),
  };
}

/**
 * Apply a fixed/tier platform fee to a subscription invoice before it finalizes
 * (BTS-51). Percent-only fees ride on the subscription's `application_fee_percent`
 * and skip this; fixed/tier fees can't be expressed that way, so BTS-15/BTS-17
 * flag the subscription with `bsFeeMode=per_invoice` + `bsFeeConfig`. Here we
 * read that flag off the subscription, compute the exact fee from the invoice
 * amount, and set `application_fee_amount` on the draft invoice. Idempotent via
 * a `bsFeeApplied` invoice-metadata marker; failures never crash the webhook.
 */
async function applyPerInvoiceFee(
  whCtx: WebhookContext,
  invoice: Stripe.Invoice,
): Promise<void> {
  try {
    if (!invoice.id) return;
    if (invoice.metadata?.bsFeeApplied) return; // already applied

    const parentSub = invoice.parent?.subscription_details?.subscription;
    const subId =
      typeof parentSub === "string" ? parentSub : (parentSub?.id ?? undefined);
    if (!subId) return;

    const sub = await whCtx.stripe.subscriptions.retrieve(subId);
    const meta = (sub.metadata ?? {}) as Record<string, string>;
    if (meta.bsFeeMode !== "per_invoice" || !meta.bsFeeConfig) return;

    let config: PlatformFeeConfig;
    try {
      config = JSON.parse(meta.bsFeeConfig) as PlatformFeeConfig;
    } catch {
      return; // malformed marker — nothing safe to apply
    }

    const fee = computeFee(invoice.amount_due, config).feeAmount;
    // A shape-invalid config (e.g. non-numeric percent) yields NaN; never send
    // a non-finite application_fee_amount to Stripe.
    if (!Number.isFinite(fee) || fee <= 0) return;

    await whCtx.stripe.invoices.update(invoice.id, {
      application_fee_amount: fee,
      metadata: { ...(invoice.metadata ?? {}), bsFeeApplied: "1" },
    });
  } catch (err) {
    // Never let fee application break webhook processing; Stripe will retry the
    // event, and a missed fixed-fee invoice can be reconciled out of band.
    console.error("[better-stripe] applyPerInvoiceFee failed:", err);
  }
}

async function upsertInvoiceFromStripe(
  whCtx: WebhookContext,
  invoice: Stripe.Invoice,
): Promise<void> {
  const { userId, orgId } = extractIdentifiers(
    invoice.metadata as Record<string, string> | null,
  );

  const parentSub = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof parentSub === "string" ? parentSub : (parentSub?.id ?? undefined);

  await dispatchUpsert(whCtx, "invoiceUpserted", {
    stripeInvoiceId: invoice.id!,
    userId,
    orgId,
    accountId: resolveOwnerAccount(invoice) ?? undefined,
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
  });
}

/**
 * Drive the split transfer engine (BTS-22) for a separate-charges sale. When a
 * PaymentIntent created with `bsChargeType=separate` succeeds, parse the split
 * (and platform fee) from its metadata and fan funds out to each recipient via
 * `source_transaction` on the resulting charge. Errors propagate so Stripe
 * retries; the engine's idempotency keys make retries safe.
 */
async function handleSplitTransfers(
  whCtx: WebhookContext,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  if (paymentIntent.status !== "succeeded") return;
  const meta = (paymentIntent.metadata ?? {}) as Record<string, string>;
  // Not a split sale — nothing to do.
  if (meta.bsChargeType !== "separate" || !meta.bsSplit) return;

  // From here the PI IS a separate-charges sale, so a missing charge or
  // malformed split is a real failure: throw so the webhook returns 500 and
  // Stripe retries (visible + recoverable) rather than silently skipping payouts.
  const sourceChargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : (paymentIntent.latest_charge?.id ?? undefined);
  if (!sourceChargeId) {
    throw new Error(
      `Split-transfer sale ${paymentIntent.id} succeeded without a latest_charge; cannot create transfers`,
    );
  }

  let split: SplitRecipient[];
  let feeConfig: PlatformFeeConfig | undefined;
  try {
    split = JSON.parse(meta.bsSplit) as SplitRecipient[];
    feeConfig = meta.bsFeeConfig
      ? (JSON.parse(meta.bsFeeConfig) as PlatformFeeConfig)
      : undefined;
  } catch (err) {
    throw new Error(
      `Split-transfer sale ${paymentIntent.id} has malformed bsSplit/bsFeeConfig metadata: ${String(err)}`,
    );
  }

  await createSplitTransfers(whCtx.stripe, whCtx.component, whCtx.ctx, {
    sourceChargeId,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    split,
    feeConfig,
    paymentId: paymentIntent.id,
  });
}

/**
 * Drive the split transfer engine for a **recurring** separate-charges sale
 * (BTS-52). On each `invoice.paid` for a subscription flagged
 * `bsChargeType=separate` (markers live on the subscription), resolve this
 * invoice's charge and fan funds out to the recipients — so an affiliate-referred
 * subscription splits every billing cycle. Each cycle has a distinct charge, so
 * the ledger keys per-charge and cycles don't collide. Errors propagate so
 * Stripe retries; the engine's idempotency keeps retries safe.
 */
async function handleInvoiceSplitTransfers(
  whCtx: WebhookContext,
  invoice: Stripe.Invoice,
): Promise<void> {
  const parentSub = invoice.parent?.subscription_details?.subscription;
  const subId =
    typeof parentSub === "string" ? parentSub : (parentSub?.id ?? undefined);
  if (!subId) return; // not a subscription invoice

  const sub = await whCtx.stripe.subscriptions.retrieve(subId);
  const meta = (sub?.metadata ?? {}) as Record<string, string>;
  if (meta.bsChargeType !== "separate" || !meta.bsSplit) return;

  let split: SplitRecipient[];
  let feeConfig: PlatformFeeConfig | undefined;
  try {
    split = JSON.parse(meta.bsSplit) as SplitRecipient[];
    feeConfig = meta.bsFeeConfig
      ? (JSON.parse(meta.bsFeeConfig) as PlatformFeeConfig)
      : undefined;
  } catch (err) {
    throw new Error(
      `Subscription ${subId} has malformed bsSplit/bsFeeConfig metadata: ${String(err)}`,
    );
  }

  // Resolve the charge that paid this invoice (source_transaction for transfers).
  const payments = await whCtx.stripe.invoicePayments.list({
    invoice: invoice.id!,
    limit: 1,
  });
  const payment = payments.data?.[0]?.payment;
  let chargeId: string | undefined;
  if (payment?.charge) {
    chargeId =
      typeof payment.charge === "string" ? payment.charge : payment.charge.id;
  } else if (payment?.payment_intent) {
    const piId =
      typeof payment.payment_intent === "string"
        ? payment.payment_intent
        : payment.payment_intent.id;
    const pi = await whCtx.stripe.paymentIntents.retrieve(piId);
    chargeId =
      typeof pi.latest_charge === "string"
        ? pi.latest_charge
        : (pi.latest_charge?.id ?? undefined);
  }
  if (!chargeId) {
    throw new Error(
      `Paid invoice ${invoice.id} for split subscription ${subId} has no resolvable charge; cannot create transfers`,
    );
  }

  await createSplitTransfers(whCtx.stripe, whCtx.component, whCtx.ctx, {
    sourceChargeId: chargeId,
    amount: invoice.amount_paid,
    currency: invoice.currency,
    split,
    feeConfig,
  });
}

async function upsertPaymentFromStripe(
  whCtx: WebhookContext,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
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

  await dispatchUpsert(whCtx, "paymentUpserted", {
    stripePaymentIntentId: paymentIntent.id,
    userId,
    orgId,
    accountId: resolveOwnerAccount(paymentIntent) ?? undefined,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status,
    // Only a succeeded intent actually collected the fee. Failed/canceled
    // intents can still carry transfer_data/application_fee_amount, so don't
    // persist fee/routing for them.
    ...(paymentIntent.status === "succeeded"
      ? feeRoutingFromPaymentIntent(paymentIntent)
      : {}),
    metadata: paymentIntent.metadata ?? undefined,
  });
}

async function handlePayoutEvent(
  whCtx: WebhookContext,
  payout: Stripe.Payout,
): Promise<void> {
  await dispatchUpsert(whCtx, "payoutUpserted", {
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
  });
}

// Stripe types Refund.status as `string | null`; clamp to the documented union.
const REFUND_STATUSES = new Set([
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
]);
const REFUND_REASONS = new Set([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
  "expired_uncaptured_charge",
]);

async function handleRefundEvent(
  whCtx: WebhookContext,
  refund: Stripe.Refund,
): Promise<void> {
  const paymentIntentId =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : (refund.payment_intent?.id ?? undefined);
  const chargeId =
    typeof refund.charge === "string"
      ? refund.charge
      : (refund.charge?.id ?? undefined);

  const status =
    refund.status && REFUND_STATUSES.has(refund.status)
      ? refund.status
      : "pending";
  const reason =
    refund.reason && REFUND_REASONS.has(refund.reason)
      ? refund.reason
      : undefined;

  await dispatchUpsert(whCtx, "refundUpserted", {
    stripeRefundId: refund.id,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: chargeId,
    amount: refund.amount,
    currency: refund.currency,
    status,
    reason,
    failureReason: refund.failure_reason ?? undefined,
    metadata: refund.metadata ?? undefined,
  });
}

async function handleDisputeEvent(
  whCtx: WebhookContext,
  dispute: Stripe.Dispute,
  lastEvent: string,
): Promise<void> {
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? undefined);
  const chargeId =
    typeof dispute.charge === "string"
      ? dispute.charge
      : (dispute.charge?.id ?? undefined);

  await dispatchUpsert(whCtx, "disputeUpserted", {
    stripeDisputeId: dispute.id,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: chargeId,
    amount: dispute.amount,
    currency: dispute.currency,
    // Stripe.Dispute.Status is exactly the component's disputeStatusValidator union.
    status: dispute.status,
    reason: dispute.reason,
    isChargeRefundable: dispute.is_charge_refundable,
    lastEvent,
    metadata: dispute.metadata ?? undefined,
  });
}
