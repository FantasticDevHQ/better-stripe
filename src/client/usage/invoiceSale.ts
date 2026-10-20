import { getMixedInvoiceSale } from "./mixedInvoiceSale.js";
import type { UsageInvoiceLineProof } from "../../shared/usageInvoiceLines.js";
import type Stripe from "stripe";
import { z } from "zod";
import type {
  FinancialOutcome,
  FinancialUnavailable,
} from "../financialOutcomes/contracts.js";
import { resolveVerifiedPaymentSource } from "../paymentSource/resolver.js";
import type { VerifiedPaymentSource } from "../paymentSource/contracts.js";
import {
  observationOptions,
  type UsageObservationOptions,
} from "./observationTypes.js";
import { observeUsageInvoice } from "./invoiceObservation.js";
import { verifyPinnedUsagePrice } from "./catalogPrices.js";
export type UsageInvoiceSaleOptions = UsageObservationOptions & {
  invoiceId: string;
  paymentIntentId: string;
  gross: number;
  /** Original licensed monthly item for this same product; server-derived enrollment terms. */
  fixedPrice?: {
    stripePriceId: string;
    subscriptionItemId: string;
    unitAmount: number;
  };
};
export type VerifiedUsageInvoiceSale = VerifiedPaymentSource & {
  invoiceLines?: UsageInvoiceLineProof[];
  stripeAccountId: string;
  meterId: string;
  subscriptionItemId: string;
  period: { start: number; end: number };
  model: "pay_as_you_go" | "included_overage";
};
const unsupported = (): FinancialUnavailable => ({
  status: "rejected",
  reason: "unsupported_source",
  retryable: false,
});
/** Native invoice/payment provenance only. Host authorizes original seller/product policy. */
export async function getUsageInvoiceSale(
  stripe: Stripe,
  input: UsageInvoiceSaleOptions,
): Promise<FinancialOutcome<VerifiedUsageInvoiceSale>> {
  try {
    const opts = observationOptions(input);
    if (input.fixedPrice) return await getMixedInvoiceSale(stripe, input);
    z.string()
      .regex(/^pi_[a-zA-Z0-9]+$/)
      .max(100)
      .parse(input.paymentIntentId);
    if (opts.binding.plan.model === "prepaid") return unsupported();
    const invoice = await observeUsageInvoice(stripe, opts, input.invoiceId);
    if (invoice.status !== "available") return unsupported();
    const value = invoice.value;
    if (value.status === "draft" || value.status === "open")
      return {
        status: "not_ready",
        reason: "provider_pending",
        retryable: true,
      };
    if (
      value.status !== "paid" ||
      !value.finalized ||
      BigInt(value.amountPaid) <= 0n
    )
      return {
        status: "rejected",
        reason: "payment_not_payable",
        retryable: false,
      };
    const paidLines = value.lines.filter((row) => BigInt(row.amount) > 0n);
    const line = paidLines[0];
    const zeroLines = value.lines.filter((row) => row.amount === "0");
    if (
      !value.linesComplete ||
      value.meterAmount.status !== "available" ||
      paidLines.length !== 1 ||
      (value.lines.length !== 1 &&
        !(
          opts.binding.plan.model === "included_overage" &&
          value.lines.length === 2 &&
          zeroLines.length === 1
        )) ||
      value.lines.some(
        (row) =>
          row.proration ||
          row.creditAppliedAmount !== "0" ||
          row.nativePeriod.start !== opts.subscription.period.start ||
          row.nativePeriod.end !== opts.subscription.period.end,
      ) ||
      !line ||
      line.proration ||
      line.creditAppliedAmount !== "0" ||
      line.nativePeriod.start !== opts.subscription.period.start ||
      line.nativePeriod.end !== opts.subscription.period.end ||
      opts.period.start !== opts.subscription.period.start ||
      opts.period.end !== opts.subscription.period.end
    )
      return unsupported();
    const [price, customer] = await Promise.all([
      stripe.prices.retrieve(opts.binding.stripePriceId, { expand: ["tiers"] }),
      stripe.customers.retrieve(opts.scope.customerAccount),
    ]);
    if (
      price.id !== opts.binding.stripePriceId ||
      customer.deleted ||
      customer.id !== opts.binding.stripeCustomerId ||
      customer.customer_account !== opts.scope.customerAccount ||
      customer.livemode !== opts.scope.livemode
    )
      return {
        status: "conflict",
        reason: "identity_changed",
        retryable: false,
      };
    verifyPinnedUsagePrice(
      price,
      {
        stripeAccountId: opts.scope.stripeAccountId,
        livemode: opts.scope.livemode,
      },
      opts.binding.plan,
      opts.scope.meterId,
      false,
    );
    const source = await resolveVerifiedPaymentSource(
      stripe,
      {
        paymentIntentId: input.paymentIntentId,
        invoiceId: input.invoiceId,
        subscriptionId: opts.subscription.subscriptionId,
        customerAccountId: opts.scope.customerAccount,
        gross: input.gross,
        currency: opts.binding.plan.rate.currency,
      },
      {
        requirePayable: true,
        customerId: opts.binding.stripeCustomerId,
        invoiceLine: {
          id: line.lineId,
          ...(zeroLines.length
            ? { zeroAmountLineIds: zeroLines.map((row) => row.lineId) }
            : {}),
          subscriptionItemId: opts.subscription.subscriptionItemId,
          period: opts.subscription.period,
        },
      },
    );
    if (source.status !== "ready") return source;
    const productId =
      typeof price.product === "string" ? price.product : price.product.id;
    if (
      source.value.stripePriceId !== opts.binding.stripePriceId ||
      source.value.stripeProductId !== productId ||
      source.value.livemode !== opts.scope.livemode ||
      String(source.value.gross) !== value.amountPaid
    )
      return {
        status: "conflict",
        reason: "identity_changed",
        retryable: false,
      };
    return {
      status: "ready",
      value: {
        ...source.value,
        stripeAccountId: opts.scope.stripeAccountId,
        meterId: opts.scope.meterId,
        subscriptionItemId: opts.subscription.subscriptionItemId,
        period: opts.subscription.period,
        model: opts.binding.plan.model,
      },
    };
  } catch {
    return {
      status: "unknown",
      reason: "provider_outcome_unknown",
      retryable: false,
    };
  }
}
