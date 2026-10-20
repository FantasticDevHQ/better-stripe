import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import type { ResolvedSettlement } from "../settlement/execution.js";
import { resolveVerifiedPaymentSource } from "../paymentSource/resolver.js";
import type { VerifiedPaymentSourceOptions } from "../paymentSource/contracts.js";
/** Refund/dispute cost observations may reuse only the complete original, sealed line proof. */
export async function retainedInvoiceSource(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  input: VerifiedPaymentSourceOptions,
) {
  const payment = await stripe.paymentIntents.retrieve(input.paymentIntentId);
  const chargeId =
    typeof payment.latest_charge === "string"
      ? payment.latest_charge
      : payment.latest_charge?.id;
  if (!chargeId) return null;
  const claim = (await ctx.runQuery(
    componentRef(component, "settlement/queries/getSettlementAllocation"),
    { sourceChargeId: chargeId },
  )) as ResolvedSettlement | null;
  const usage = claim?.usageSource;
  if (
    !claim ||
    !usage?.invoiceLines?.length ||
    claim.paymentIntentId !== input.paymentIntentId ||
    claim.gross !== input.gross ||
    claim.currency !== input.currency ||
    usage.customerAccount !== input.customerAccountId ||
    usage.livemode !== payment.livemode ||
    input.stripeAccountId ||
    (input.invoiceId !== undefined &&
      input.invoiceId !== claim.sourceInvoiceId) ||
    (input.subscriptionId !== undefined &&
      input.subscriptionId !== usage.subscriptionId)
  )
    return null;
  const customerId =
    typeof payment.customer === "string"
      ? payment.customer
      : payment.customer?.id;
  if (!customerId) return null;
  const realm = await stripe.accounts.retrieve(null);
  if (realm.id !== usage.stripeAccountId) return null;
  const result = await resolveVerifiedPaymentSource(
    stripe,
    {
      ...input,
      invoiceId: claim.sourceInvoiceId,
      subscriptionId: usage.subscriptionId,
    },
    {
      requirePayable: false,
      customerId,
      verifyInvoiceLines(invoice, lines) {
        if (
          invoice.id !== claim.sourceInvoiceId ||
          (invoice.starting_balance ?? 0) !== 0 ||
          (invoice.ending_balance ?? 0) !== 0 ||
          (invoice.total_discount_amounts ?? []).length ||
          (invoice.total_taxes ?? []).length ||
          lines.length !== usage.invoiceLines!.length
        )
          return null;
        for (const line of lines) {
          const saved = usage.invoiceLines!.find(
              (row) => row.lineId === line.id,
            ),
            parent = line.parent?.subscription_item_details,
            price = line.pricing?.price_details;
          if (
            !saved ||
            line.object !== "line_item" ||
            line.invoice !== invoice.id ||
            line.currency !== claim.currency ||
            line.livemode !== usage.livemode ||
            !parent ||
            parent.proration ||
            parent.subscription !== usage.subscriptionId ||
            parent.subscription_item !== saved.subscriptionItemId ||
            line.pricing?.type !== "price_details" ||
            price?.price !== saved.stripePriceId ||
            price.product !== saved.stripeProductId ||
            line.amount !== saved.amount ||
            (line.quantity_decimal?.toString() ?? String(line.quantity)) !==
              saved.quantity ||
            line.period.start !== saved.period.start ||
            line.period.end !== saved.period.end ||
            (line.discount_amounts ?? []).length ||
            (line.pretax_credit_amounts ?? []).length ||
            (line.taxes ?? []).length
          )
            return null;
        }
        return {
          stripePriceId: usage.stripePriceId,
          stripeProductId: usage.stripeProductId,
        };
      },
    },
  );
  if (
    result.status === "ready" &&
    (result.value.chargeId !== claim.sourceChargeId ||
      result.value.invoicePaymentId !== usage.invoicePaymentId ||
      result.value.processingFee !== claim.processingFee)
  )
    return {
      status: "conflict" as const,
      reason: "identity_changed" as const,
      retryable: false as const,
    };
  return result;
}
