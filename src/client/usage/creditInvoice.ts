import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { creditCost, type UsageCreditPurchaseTerms } from "./creditTerms.js";
import { creditRequire } from "./creditNative.js";
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
/** Prove the credit-funded line against immutable original accepted usage, never current prices. */
export async function verifyCreditInvoice(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  terms: UsageCreditPurchaseTerms,
  transaction: Stripe.Billing.CreditBalanceTransaction,
): Promise<boolean> {
  const debit = transaction.debit,
    source = debit?.credits_applied;
  if (debit?.type !== "credits_applied" || !source) return false;
  const invoiceId = id(source.invoice);
  creditRequire(invoiceId, "Credit invoice identity unavailable");
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subscriptionId = id(invoice.parent?.subscription_details?.subscription);
  if (
    invoice.id !== invoiceId ||
    !subscriptionId ||
    invoice.livemode !== terms.scope.livemode ||
    invoice.customer_account !== terms.scope.customerAccount ||
    id(invoice.customer) !== terms.binding.stripeCustomerId ||
    invoice.currency !== terms.binding.plan.rate.currency ||
    !["open", "paid", "uncollectible"].includes(invoice.status ?? "") ||
    !invoice.status_transitions.finalized_at ||
    invoice.lines.has_more ||
    invoice.lines.data.length > 100
  )
    return false;
  const line = invoice.lines.data.find(
    (l) => l.id === source.invoice_line_item,
  );
  const parent = line?.parent?.subscription_item_details;
  const raw = line?.quantity_decimal?.toString();
  if (
    !line ||
    !parent ||
    parent.subscription !== subscriptionId ||
    !parent.subscription_item ||
    parent.proration ||
    line.pricing?.price_details?.price !== terms.binding.stripePriceId ||
    line.currency !== terms.binding.plan.rate.currency ||
    !raw ||
    !/^\d+(\.0+)?$/.test(raw)
  )
    return false;
  const local = (await ctx.runQuery(
    componentRef(component, "usageCredits/queries/invoiceUsage"),
    {
      bindingJson: JSON.stringify({
        scope: terms.scope,
        binding: terms.binding,
      }),
      subscriptionId,
      subscriptionItemId: parent.subscription_item,
      start: line.period.start,
      end: line.period.end,
    },
  )) as { complete: boolean; valid: boolean; scaledQuantity: string };
  const scaled = BigInt(raw.split(".")[0]);
  if (
    !local.complete ||
    !local.valid ||
    scaled !== BigInt(local.scaledQuantity) ||
    scaled === 0n ||
    line.amount !== creditCost(terms.binding.plan, scaled.toString())
  )
    return false;
  const credits = line.pretax_credit_amounts ?? [];
  return (
    credits.some(
      (c) =>
        c.type === "credit_balance_transaction" &&
        id(c.credit_balance_transaction) === transaction.id &&
        c.amount === debit.amount.monetary?.value,
    ) &&
    credits
      .filter((c) => c.type === "credit_balance_transaction")
      .reduce((sum, c) => sum + BigInt(c.amount), 0n) === BigInt(line.amount)
  );
}
