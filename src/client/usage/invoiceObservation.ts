import type Stripe from "stripe";
import { z } from "zod";
import {
  observationOptions,
  verifyObservationSource,
  type UsageObservationOptions,
} from "./observationTypes.js";
import type { UsageAvailability } from "./boundaries.js";
import { UsageCatalogError } from "./catalogTypes.js";
import { decimalFromScaled } from "./summary.js";
export type UsageInvoiceLine = {
  lineId: string;
  stripePriceId: string;
  subscriptionItemId: string;
  amount: string;
  currency: string;
  quantity: string | null;
  providerQuantityDecimal: string | null;
  unitAmountDecimal: string | null;
  creditAppliedAmount: string;
  nativePeriod: { start: number; end: number };
  proration: boolean;
};
export type UsageInvoiceObservation = {
  kind: "preview" | "invoice";
  invoiceId: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  finalized: boolean;
  amountDue: string;
  amountPaid: string;
  total: string;
  currency: string;
  linesComplete: boolean;
  lines: UsageInvoiceLine[];
  meterAmount: UsageAvailability<{ amount: string; currency: string }>;
  paymentEvidence: "not_resolved";
};
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
function amount(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error("Unsafe native amount");
  return String(value);
}
function decimal(value: Stripe.Decimal | null | undefined): string | null {
  if (value == null) return null;
  const text = value.toString();
  if (!/^\d+(\.\d{1,12})?$/.test(text) || text.length > 64)
    throw new Error("Unsupported native decimal");
  return text;
}
export async function observeUsageInvoice(
  stripe: Stripe,
  input: UsageObservationOptions,
  invoiceId?: string,
): Promise<UsageAvailability<UsageInvoiceObservation>> {
  const opts = observationOptions(input),
    observedAt = Math.floor(Date.now() / 1000);
  if (invoiceId !== undefined)
    z.string()
      .regex(/^in_[a-zA-Z0-9]+$/)
      .max(100)
      .parse(invoiceId);
  try {
    if (!(await verifyObservationSource(stripe, opts)))
      return {
        status: "unsupported",
        reason: "provider_binding_mismatch",
        retryable: false,
      };
    const invoice = invoiceId
      ? await stripe.invoices.retrieve(invoiceId)
      : await stripe.invoices.createPreview({
          subscription: opts.subscription.subscriptionId,
          customer_account: opts.scope.customerAccount,
        });
    const status = z
      .enum(["draft", "open", "paid", "void", "uncollectible"])
      .safeParse(invoice.status);
    if (
      !status.success ||
      !invoice.id ||
      invoice.id.length > 100 ||
      (invoiceId && invoice.id !== invoiceId) ||
      invoice.livemode !== opts.scope.livemode ||
      invoice.customer_account !== opts.scope.customerAccount ||
      idOf(invoice.customer) !== opts.binding.stripeCustomerId ||
      idOf(invoice.parent?.subscription_details?.subscription) !==
        opts.subscription.subscriptionId ||
      invoice.currency !== opts.binding.plan.rate.currency
    )
      return {
        status: "unsupported",
        reason: "invoice_binding_mismatch",
        retryable: false,
      };
    const lines: UsageInvoiceLine[] = [];
    let ambiguous = false;
    const linesComplete =
      !invoice.lines.has_more && invoice.lines.data.length <= 100;
    for (const line of invoice.lines.data.slice(0, 100)) {
      if (line.pricing?.price_details?.price !== opts.binding.stripePriceId)
        continue;
      const parent = line.parent?.subscription_item_details;
      if (
        parent?.subscription !== opts.subscription.subscriptionId ||
        parent.subscription_item !== opts.subscription.subscriptionItemId ||
        line.currency !== invoice.currency
      ) {
        ambiguous = true;
        continue;
      }
      const providerQuantity = decimal(line.quantity_decimal);
      let quantity: string | null = null;
      if (providerQuantity !== null) {
        const [whole, fraction = ""] = providerQuantity.split(".");
        quantity = decimalFromScaled(
          BigInt(whole + fraction),
          fraction.length + opts.binding.plan.unit.precision,
        );
      }
      const creditApplied = (line.pretax_credit_amounts ?? [])
        .filter((value) => value.type === "credit_balance_transaction")
        .reduce((sum, value) => sum + BigInt(amount(value.amount)), 0n);
      lines.push({
        lineId: line.id,
        stripePriceId: opts.binding.stripePriceId,
        subscriptionItemId: parent.subscription_item,
        amount: amount(line.amount),
        currency: line.currency,
        quantity,
        providerQuantityDecimal: providerQuantity,
        unitAmountDecimal: decimal(line.pricing.unit_amount_decimal),
        creditAppliedAmount: creditApplied.toString(),
        nativePeriod: { start: line.period.start, end: line.period.end },
        proration: parent.proration,
      });
    }
    const meterAmount: UsageInvoiceObservation["meterAmount"] = !linesComplete
      ? {
          status: "unavailable",
          reason: "invoice_history_incomplete",
          retryable: true,
        }
      : ambiguous
        ? {
            status: "unavailable",
            reason: "ambiguous_invoice_items",
            retryable: false,
          }
        : !lines.length
          ? {
              status: "unavailable",
              reason: "metered_lines_not_observed",
              retryable: true,
            }
          : {
              status: "available",
              observedAt,
              value: {
                amount: lines
                  .reduce((sum, line) => sum + BigInt(line.amount), 0n)
                  .toString(),
                currency: invoice.currency,
              },
            };
    return {
      status: "available",
      observedAt,
      value: {
        kind: invoiceId ? "invoice" : "preview",
        invoiceId: invoice.id,
        status: status.data,
        finalized:
          invoiceId !== undefined &&
          invoice.status !== "draft" &&
          Number.isSafeInteger(invoice.status_transitions?.finalized_at),
        amountDue: amount(invoice.amount_due),
        amountPaid: amount(invoice.amount_paid),
        total: amount(invoice.total),
        currency: invoice.currency,
        linesComplete,
        lines,
        meterAmount,
        paymentEvidence: "not_resolved",
      },
    };
  } catch (error) {
    if (
      error instanceof UsageCatalogError &&
      error.code === "unsupported_scope"
    )
      return {
        status: "unsupported",
        reason: "unsupported_scope",
        retryable: false,
      };
    return {
      status: "unavailable",
      reason: "invoice_unavailable",
      retryable: true,
    };
  }
}
