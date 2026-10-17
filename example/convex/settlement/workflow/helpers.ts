import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { internal, components } from "../../_generated/api";
export const saleAllocation = (sale: Doc<"storeSales">) => ({
  sourceChargeId: sale.chargeId,
  paymentIntentId: sale.paymentIntentId,
  ...(sale.sourceInvoiceId ? { sourceInvoiceId: sale.sourceInvoiceId } : {}),
  gross: sale.gross,
  currency: sale.currency,
  processingFee: sale.processingFee,
  platformNet: sale.platformNet,
  adjustmentAmount: sale.costRecoveryAmount ?? 0,
  transfers: [
    {
      destinationAccountId: sale.sellerAccountId,
      role: "store" as const,
      amount: sale.sellerNet,
    },
    ...(sale.affiliateAccountId
      ? [
          {
            destinationAccountId: sale.affiliateAccountId,
            role: "affiliate" as const,
            amount: sale.affiliateNet,
          },
        ]
      : []),
  ],
});
/** Projection repair consumes exact recorded receipts. It performs no provider IO or financial write. */
export async function verifiedSaleTransferUpdates(
  ctx: MutationCtx,
  sale: Doc<"storeSales">,
) {
  const rows = await ctx.runQuery(
    components.betterStripe.connect.queries.listTransfersByCharge,
    { sourceChargeId: sale.chargeId },
  );
  const legs = saleAllocation(sale).transfers.filter((leg) => leg.amount > 0);
  if (rows.length !== legs.length)
    throw new Error("Settlement transfer mirrors are incomplete or ambiguous.");
  const updates: { sellerTransferId?: string; affiliateTransferId?: string } =
    {};
  for (const leg of legs) {
    const matches = rows.filter(
      (row) =>
        row.destinationAccountId === leg.destinationAccountId &&
        row.role === leg.role,
    );
    const row = matches[0];
    if (
      matches.length !== 1 ||
      !row ||
      row.sourceChargeId !== sale.chargeId ||
      row.amount !== leg.amount ||
      row.currency !== sale.currency ||
      (row.sourceInvoiceId !== undefined &&
        row.sourceInvoiceId !== sale.sourceInvoiceId) ||
      !["paid", "partially_reversed", "reversed"].includes(row.status) ||
      !row.stripeTransferId ||
      !Number.isSafeInteger(row.reversedAmount ?? 0) ||
      (row.reversedAmount ?? 0) < 0 ||
      (row.reversedAmount ?? 0) > row.amount
    )
      throw new Error(
        "Settlement transfer mirrors do not match the original allocation.",
      );
    if (leg.role === "store") updates.sellerTransferId = row.stripeTransferId;
    else updates.affiliateTransferId = row.stripeTransferId;
  }
  return updates;
}
export async function projectSaleMirrors(
  ctx: MutationCtx,
  sale: Doc<"storeSales">,
) {
  const updates = await verifiedSaleTransferUpdates(ctx, sale);
  await ctx.db.patch("storeSales", sale._id, {
    ...updates,
    status: "settled",
    settlementAttempted: true,
  });
  const blocked = await ctx.db
    .query("recoveryJobs")
    .withIndex("by_request", (q) =>
      q.eq("requestKey", `example:blocked-cost:${sale.paymentIntentId}`),
    )
    .unique();
  if (blocked)
    await ctx.scheduler.runAfter(
      0,
      internal.sellerCosts.actions.reconcileWhenReady,
      { paymentIntentId: sale.paymentIntentId },
    );
}

/** Preserve routing metadata while a bounded preparation advances the final split. */
export async function projectSalePayment(
  ctx: MutationCtx,
  sale: Doc<"storeSales">,
) {
  const payment = await ctx.runQuery(
    components.betterStripe.connect.queries.getPaymentByStripeId,
    { stripePaymentIntentId: sale.paymentIntentId },
  );
  if (!payment) return;
  if (
    payment.amount !== sale.gross ||
    payment.currency !== sale.currency ||
    payment.destinationAccountId !== sale.sellerAccountId ||
    payment.chargeType !== "separate" ||
    (payment.metadata?.sellerId !== undefined &&
      payment.metadata.sellerId !== sale.sellerId)
  )
    throw new Error("Original payment projection ownership changed.");
  await ctx.runMutation(
    components.betterStripe.connect.mutations.upsertPayment,
    {
      stripePaymentIntentId: sale.paymentIntentId,
      userId: payment.userId,
      amount: sale.gross,
      currency: sale.currency,
      status: "succeeded",
      destinationAccountId: sale.sellerAccountId,
      chargeType: "separate",
      feeCollectedAmount: sale.sellingFee,
      splitRecipients: saleAllocation(sale).transfers.filter(
        (leg) => leg.amount > 0,
      ),
      metadata: {
        ...payment.metadata,
        processingFee: String(sale.processingFee),
        platformNet: String(sale.platformNet),
        costRecoveryAmount: String(sale.costRecoveryAmount ?? 0),
      },
    },
  );
}
