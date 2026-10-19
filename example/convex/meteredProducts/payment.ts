import type Stripe from "stripe";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { getStripeClient } from "../stripe/client";
import { assertBasePrice, assertPaidEnrollment } from "./policy";
import { observeEnrollment } from "./native";
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
/** Enrollment entitlement only. This is not a seller-settlement proof or fee calculation. */
export async function paidEnrollment(
  ctx: ActionCtx,
  input: Parameters<typeof observeEnrollment>[1],
) {
  const ref = { actorId: input.actorId, enrollmentId: input.enrollmentId };
  const original = await observeEnrollment(ctx, ref);
  const { offer, provider, payer, subscription, meter, enrollment } = original;
  if (
    meter.binding.plan.model === "prepaid" &&
    subscription.collection.method !== "send_invoice"
  )
    throw new Error(
      "Original prepaid enrollment requires manual invoice collection.",
    );
  if (!provider.basePriceId) return original;
  const raw = getStripeClient();
  assertBasePrice(
    {
      productId: offer.productId,
      baseAmount: offer.baseAmount,
      currency: provider.price.currency,
    },
    await raw.prices.retrieve(provider.basePriceId),
  );
  const sub = await raw.subscriptions.retrieve(subscription.subscriptionId);
  if (
    sub.id !== subscription.subscriptionId ||
    sub.status !== "active" ||
    sub.currency !== subscription.currency ||
    sub.billing_mode.type !== subscription.billingMode ||
    sub.collection_method !== subscription.collection.method ||
    (id(sub.default_payment_method) ?? null) !==
      subscription.collection.defaultPaymentMethod ||
    sub.cancel_at_period_end !== subscription.cancelAtPeriodEnd ||
    sub.items.has_more ||
    sub.items.data.length !== subscription.items.length ||
    sub.items.data.some((item) => {
      const originalItem = subscription.items.find(
        (saved) => saved.id === item.id,
      );
      return (
        !originalItem ||
        item.price.id !== originalItem.stripePriceId ||
        item.current_period_start !== originalItem.period.start ||
        item.current_period_end !== originalItem.period.end ||
        (item.quantity === undefined || item.quantity === null
          ? null
          : String(item.quantity)) !== originalItem.quantity
      );
    }) ||
    sub.customer_account !== payer.accountId ||
    id(sub.customer) !== payer.customerId ||
    sub.livemode
  )
    throw new Error("Original enrollment payment is unavailable.");
  let invoiceId = enrollment.initialInvoiceId;
  if (!invoiceId) {
    const page = await raw.invoices.list({
      customer_account: payer.accountId,
      subscription: sub.id,
      limit: 100,
    });
    const initial = page.data.filter(
      (invoice) =>
        invoice.billing_reason === "subscription_create" &&
        id(invoice.parent?.subscription_details?.subscription) === sub.id,
    );
    if (page.has_more || initial.length !== 1)
      throw new Error("Original enrollment payment history is incomplete.");
    invoiceId = initial[0].id;
  }
  const currentId = id(sub.latest_invoice);
  if (!currentId) throw new Error("Current period payment is unavailable.");
  for (const originalId of new Set([invoiceId, currentId])) {
    const invoice = await raw.invoices.retrieve(originalId);
    const lines = await raw.invoices.listLineItems(invoice.id, { limit: 100 });
    const baseLines = lines.data.filter(
      (line) => id(line.pricing?.price_details?.price) === provider.basePriceId,
    );
    const base = baseLines[0];
    if (
      invoice.id !== originalId ||
      invoice.livemode ||
      invoice.customer_account !== payer.accountId ||
      id(invoice.customer) !== payer.customerId ||
      id(invoice.parent?.subscription_details?.subscription) !== sub.id ||
      baseLines.length !== 1 ||
      !base ||
      id(base.pricing?.price_details?.product) !== offer.productId ||
      invoice.amount_remaining !== 0 ||
      invoice.amount_overpaid !== 0 ||
      invoice.total !== invoice.amount_paid ||
      (originalId === invoiceId && invoice.amount_paid !== offer.baseAmount) ||
      (originalId === currentId &&
        (base.period.start !== meter.subscription.period.start ||
          base.period.end !== meter.subscription.period.end))
    )
      throw new Error("Original period payment terms do not match.");
    const payments = await raw.invoicePayments.list({
      invoice: invoice.id,
      limit: 100,
    });
    const paid = payments.data.filter(
      (payment) => payment.status === "paid" && (payment.amount_paid ?? 0) > 0,
    );
    if (payments.has_more || paid.length !== 1)
      throw new Error("Original payment funding is incomplete.");
    const funding = paid[0];
    if (
      funding.livemode ||
      id(funding.invoice) !== invoice.id ||
      funding.currency !== invoice.currency ||
      funding.amount_paid !== invoice.amount_paid ||
      funding.amount_requested !== invoice.amount_paid ||
      funding.payment.type !== "payment_intent"
    )
      throw new Error("Original payment funding changed.");
    const paymentId = id(funding.payment.payment_intent);
    if (!paymentId)
      throw new Error("Original captured payment is unavailable.");
    const payment = await raw.paymentIntents.retrieve(paymentId, {
      expand: ["latest_charge"],
    });
    const charge = payment.latest_charge as Stripe.Charge | null;
    if (
      payment.id !== paymentId ||
      !charge ||
      typeof charge === "string" ||
      payment.livemode ||
      charge.livemode ||
      id(charge.payment_intent) !== payment.id ||
      payment.customer_account !== payer.accountId ||
      id(payment.customer) !== payer.customerId ||
      payment.currency !== invoice.currency ||
      charge.currency !== invoice.currency ||
      id(charge.customer) !== payer.customerId ||
      ("customer_account" in charge &&
        charge.customer_account !== payer.accountId) ||
      !charge.paid ||
      !charge.captured ||
      payment.amount_received !== invoice.amount_paid
    )
      throw new Error("Original captured payment changed.");
    assertPaidEnrollment(
      {
        invoiceId: originalId,
        subscriptionId: sub.id,
        customerAccount: payer.accountId,
        customerId: payer.customerId,
        baseAmount: offer.baseAmount,
        currency: provider.price.currency,
        basePriceId: provider.basePriceId,
      },
      {
        invoiceId: invoice.id,
        subscriptionId:
          id(invoice.parent?.subscription_details?.subscription) ?? "",
        customerAccount: invoice.customer_account ?? "",
        customerId: id(invoice.customer) ?? "",
        currency: invoice.currency,
        status: invoice.status,
        amountPaid: invoice.amount_paid,
        amountDue: invoice.amount_due,
        complete: !lines.has_more,
        basePriceId: id(base.pricing?.price_details?.price) ?? null,
        baseQuantity: base.quantity,
        baseAmount: base.amount,
        captured: charge.amount_captured,
        refunded: charge.amount_refunded,
        disputed: charge.disputed,
        paymentStatus: payment.status,
      },
    );
  }
  if (!enrollment.initialInvoiceId)
    await ctx.runMutation(internal.meteredProducts.enrollments.pin, {
      ...ref,
      initialInvoiceId: invoiceId,
    });
  return original;
}
