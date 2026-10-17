import type Stripe from "stripe";
import { saleAmountFailure } from "../paymentSource/economics.js";
import { isBetterStripeError, throwStripeError } from "../errors.js";
export type VerifiedSaleOptions = {
  paymentIntentId: string;
  subscriptionId?: string;
  invoiceId?: string;
};
export type VerifiedSale =
  | { status: "pending" | "not_payable"; reason: string; retryable: boolean }
  | {
      status: "ready";
      paymentIntentId: string;
      chargeId: string;
      gross: number;
      processingFee: number;
      currency: string;
      metadata: Record<string, string>;
      invoiceId?: string;
      subscriptionId?: string;
      stripePriceId?: string;
      stripeProductId?: string;
    };
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
export async function getVerifiedSale(
  stripe: Stripe,
  opts: VerifiedSaleOptions,
): Promise<VerifiedSale> {
  try {
    const payment = await stripe.paymentIntents.retrieve(opts.paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    if (payment.status === "processing")
      return {
        status: "pending",
        reason: "payment_processing",
        retryable: true,
      };
    if (payment.status !== "succeeded")
      return {
        status: "not_payable",
        reason: "payment_not_succeeded",
        retryable: false,
      };
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string")
      return {
        status: "pending",
        reason: "charge_unavailable",
        retryable: true,
      };
    if (charge.amount_refunded > 0 || charge.disputed)
      return {
        status: "not_payable",
        reason: "charge_refunded_or_disputed",
        retryable: false,
      };
    const balance = charge.balance_transaction;
    if (!balance || typeof balance === "string")
      return {
        status: "pending",
        reason: "processing_fee_unavailable",
        retryable: true,
      };
    const amountFailure = saleAmountFailure(payment, charge, balance);
    if (amountFailure === "currency")
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Settlement currency must match the payment and processing currency.",
      );
    if (amountFailure === "amounts")
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Unsupported payment or processing amounts.",
      );
    if (opts.subscriptionId && !opts.invoiceId)
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Subscription settlement requires a paid invoice.",
      );
    const invoice = opts.invoiceId
      ? await stripe.invoices.retrieve(opts.invoiceId)
      : null;
    if (invoice && invoice.status !== "paid")
      return { status: "pending", reason: "invoice_not_paid", retryable: true };
    const subscriptionId = id(
      invoice?.parent?.subscription_details?.subscription,
    );
    if (
      invoice &&
      (invoice.currency !== payment.currency ||
        (opts.subscriptionId && subscriptionId !== opts.subscriptionId))
    )
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Invoice currency or subscription does not match settlement.",
      );
    if (invoice) {
      if (invoice.amount_paid !== payment.amount_received)
        throwStripeError(
          "INVALID_CONFIGURATION",
          "Partial invoice payments require an explicitly resolved invoice allocation.",
        );
      const linked = await stripe.invoicePayments.list({
        invoice: invoice.id,
        limit: 100,
        status: "paid",
        payment: { type: "payment_intent", payment_intent: payment.id },
      });
      if (
        !linked.data.some(
          (row) =>
            row.status === "paid" &&
            id(row.payment.payment_intent) === payment.id,
        )
      )
        throwStripeError(
          "INVALID_CONFIGURATION",
          "Payment does not belong to this paid invoice.",
        );
    }
    const subscription = subscriptionId
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : null;
    if (subscription && subscription.items.data.length !== 1)
      throwStripeError(
        "INVALID_CONFIGURATION",
        "Resolve multi-price subscription allocations explicitly.",
      );
    const price = subscription?.items.data[0]?.price;
    const metadata = subscription?.metadata ?? payment.metadata;
    return {
      status: "ready",
      paymentIntentId: payment.id,
      chargeId: charge.id,
      gross: payment.amount_received,
      processingFee: balance.fee,
      currency: payment.currency,
      metadata,
      invoiceId: invoice?.id,
      subscriptionId,
      stripePriceId: price?.id ?? metadata.stripePriceId,
      stripeProductId: id(price?.product) ?? metadata.stripeProductId,
    };
  } catch (error) {
    if (isBetterStripeError(error)) throw error;
    throwStripeError(
      "STRIPE_API_ERROR",
      "Could not retrieve verified sale context.",
    );
  }
}
