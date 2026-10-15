import { stripe } from "../stripe";
import { getStripeClient } from "./stripeClient";
import { internal } from "../_generated/api";
import { costScope } from "./sellerRecovery";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
/** Route a returned funding payment; the package verifies full invoice/payment economics. */
export async function reconcileInvoiceFunding(
  ctx: ActionCtx,
  cost: { paymentIntentId: string; gross: number; currency: string },
) {
  const paymentIntentId = cost.paymentIntentId;
  let matched: Awaited<ReturnType<typeof stripe.costRecovery.getGroup>> = null;
  for await (const payment of getStripeClient().invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    status: "paid",
    limit: 100,
  })) {
    if (
      payment.status !== "paid" ||
      id(payment.payment.payment_intent) !== paymentIntentId
    )
      throw new Error("Invoice funding payment identity does not match.");
    const invoiceId = id(payment.invoice);
    if (!invoiceId) throw new Error("Invoice funding source is unavailable.");
    const group = await stripe.costRecovery.getGroup(ctx, {
      groupKey: `example:cost-invoice:${invoiceId}`,
    });
    if (!group) continue;
    if (
      group.sourceKind !== "invoice" ||
      group.sourceId !== invoiceId ||
      group.currency !== payment.currency
    )
      throw new Error("Invoice funding recovery scope does not match.");
    if (matched && matched.groupKey !== group.groupKey)
      throw new Error(
        "Invoice funding allocation_required for multiple recovery invoices.",
      );
    matched = group;
  }
  if (!matched) return null;
  const sellerId = matched.scopeKey.startsWith("example:store:")
    ? matched.scopeKey.slice("example:store:".length)
    : "";
  const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
    sellerId: sellerId as Id<"users">,
  });
  if (seller.stripeAccountId !== matched.accountId)
    throw new Error("Invoice funding recovery owner changed.");
  const previous = await stripe.costRecovery.getClaim(ctx, {
    claimKey: `rollback:${matched.groupKey}`,
  });
  await ctx.runAction(internal.recoveryInvoices.reconcile, {
    sellerId: seller.sellerId,
    invoiceId: matched.sourceId,
  });
  const result = await stripe.costRecovery.rollbackInvoice(ctx, {
    ...costScope(seller.sellerId, matched.accountId, matched.currency),
    groupKey: matched.groupKey,
    revision: (previous?.revision ?? -1) + 1,
  });
  if (result.status !== "ready")
    throw new Error(
      `Stripe refund costs are not available yet (${result.reason}).`,
    );
  if (cost.currency !== matched.currency)
    throw new Error("Invoice funding source currency changed.");
  return {
    sellerId: seller.sellerId,
    gross: cost.gross,
    currency: cost.currency,
    sellingFee: Math.max(0, Math.min(cost.gross, cost.gross - matched.amount)),
    costRecoveryAmount: 0,
    invoiceRecoveryGroupKey: matched.groupKey,
  };
}
