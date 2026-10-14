import type Stripe from "stripe";
import { resolveOwnerAccount } from "../utils/owner.js";

export type UpcomingInvoicePreviewOptions = {
  /** Host must authorize this customer account before calling. */
  customerAccount: string;
  stripeSubscriptionId: string;
};

/** Provider amounts are integer minor units; all dates are milliseconds. */
export type UpcomingInvoicePreview = {
  stripeInvoiceId: string;
  currency: string;
  total: number;
  subtotal: number;
  amountDue: number;
  nextBillingAt: number;
  periodStart: number;
  periodEnd: number;
  linesComplete: true;
  lines: {
    id: string;
    description: string;
    amount: number;
    currency: string;
    periodStart: number;
    periodEnd: number;
  }[];
};

function integer(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new Error("Invoice preview amounts and dates must be safe integers.");
  return value;
}

export async function getUpcomingInvoicePreview(
  stripe: Stripe,
  opts: UpcomingInvoicePreviewOptions,
): Promise<UpcomingInvoicePreview> {
  if (!opts.customerAccount.startsWith("acct_") || !opts.stripeSubscriptionId)
    throw new Error("A customer account and subscription are required.");
  const subscription = await stripe.subscriptions.retrieve(
    opts.stripeSubscriptionId,
  );
  if (resolveOwnerAccount(subscription) !== opts.customerAccount)
    throw new Error("Subscription does not belong to the customer account.");
  const preview = await stripe.invoices.createPreview({
    customer_account: opts.customerAccount,
    subscription: opts.stripeSubscriptionId,
  });
  const lines: UpcomingInvoicePreview["lines"] = [];
  const append = (line: Stripe.InvoiceLineItem) => {
    if (line.currency !== preview.currency)
      throw new Error(
        "Invoice preview line currency does not match the invoice.",
      );
    lines.push({
      id: line.id,
      description: line.description ?? "Subscription",
      amount: integer(line.amount),
      currency: line.currency,
      periodStart: integer(line.period.start * 1000),
      periodEnd: integer(line.period.end * 1000),
    });
  };
  if (preview.lines.has_more) {
    for await (const line of stripe.invoices.listLineItems(preview.id, {
      limit: 100,
    }))
      append(line);
  } else {
    preview.lines.data.forEach(append);
  }
  const renewalDates = subscription.items.data.map(
    (item) => item.current_period_end,
  );
  const nextBillingAt =
    preview.next_payment_attempt ??
    (subscription.status === "trialing" ? subscription.trial_end : null) ??
    Math.min(...renewalDates);
  return {
    stripeInvoiceId: preview.id,
    currency: preview.currency,
    total: integer(preview.total),
    subtotal: integer(preview.subtotal),
    amountDue: integer(preview.amount_due),
    nextBillingAt: integer(nextBillingAt * 1000),
    periodStart: integer(preview.period_start * 1000),
    periodEnd: integer(preview.period_end * 1000),
    linesComplete: true,
    lines,
  };
}
