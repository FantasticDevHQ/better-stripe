import { reconcileInvoiceFunding } from "./lib/invoiceRecoverySource";
import { costClaimKey } from "./lib/sellerRecovery";
import { unsettledCostSource } from "./lib/unsettledCostSource";
import { stripe } from "./stripe";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { stripeCostDeficit } from "./lib/sellerCosts";
import type { Id } from "./_generated/dataModel";

export const reconcile = internalAction({
  args: { paymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const observedAt = Date.now();
    const previousClaim = await stripe.costRecovery.getClaim(ctx, {
      claimKey: costClaimKey(args.paymentIntentId),
    });
    const cost = await stripe.getProcessingCostContext(ctx, args);
    if (cost.status === "not_ready") {
      if (
        cost.reason === "payment_not_succeeded" ||
        cost.reason === "charge_unavailable"
      )
        return null;
      throw new Error(
        `Stripe processing costs are not available yet (${cost.reason}).`,
      );
    }
    const settled = await ctx.runQuery(
      internal.storeSaleSettlement.getByCharge,
      {
        chargeId: cost.chargeId,
      },
    );
    if (
      settled?.status === "pending" &&
      settled.recoveryReady !== undefined &&
      cost.principalReturned > 0
    )
      await ctx.runMutation(
        internal.storeSaleSettlement.markUnpaidSaleRefunded,
        { chargeId: cost.chargeId },
      );
    const invoiceSource =
      !settled && cost.metadata.storeBilling !== "sale_v1"
        ? await reconcileInvoiceFunding(ctx, cost)
        : null;
    const sale =
      settled ?? invoiceSource ?? (await unsettledCostSource(ctx, cost));
    if (!sale) return null;
    if (sale.currency !== cost.currency || sale.gross !== cost.gross)
      throw new Error("Stripe cost context does not match the original sale.");
    const disputeFees = Math.max(0, cost.disputeFeeAdjustment);
    const principalReturned = cost.principalReturned;
    const processingFee = Math.max(
      0,
      cost.processingFee + cost.refundFeeAdjustment,
    );
    const processingLoss = stripeCostDeficit({
      gross: sale.gross,
      sellingFee: sale.sellingFee,
      processingFee,
      principalReturned,
      disputeFees: 0,
    });
    // Returning a payment also returns any previous cost adjustment funded by
    // that payment. Reinstate that adjustment so old expenses aren't forgiven.
    const adjustmentRollback = settled?.recoveryGroupKey
      ? 0
      : Math.round(
          ((sale.costRecoveryAmount ?? 0) * principalReturned) / sale.gross,
        );
    await ctx.runMutation(internal.sellerCostBilling.record, {
      sellerId: sale.sellerId,
      sourceChargeId: cost.chargeId,
      paymentIntentId: cost.paymentIntentId,
      currency: sale.currency,
      sourceType: cost.disputes.length ? "dispute" : "refund",
      amountDue: processingLoss + disputeFees + adjustmentRollback,
      processingLoss,
      disputeFees,
      observedAt,
      sourceGross: cost.gross,
      sourceProcessingFee: cost.processingFee,
      expectedRevision: previousClaim?.revision ?? -1,
      invoiceRecoveryGroupKey: invoiceSource?.invoiceRecoveryGroupKey,
    });
    if (settled?.recoveryGroupKey) {
      const group = await stripe.costRecovery.getGroup(ctx, {
        groupKey: settled.recoveryGroupKey,
      });
      if (group?.status === "collected")
        await stripe.costRecovery.rollback(ctx, {
          groupKey: group.groupKey,
          returnedPrincipal: principalReturned,
          revision: (previousClaim?.revision ?? -1) + 1,
        });
    }
    return null;
  },
});

export const attachToInvoice = internalAction({
  args: { invoiceId: v.string(), sellerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runAction(internal.recoveryInvoices.attach, args);
    return null;
  },
});

/** Reconcile already-existing example sales after adding cost recovery. */
export const reconcileExisting = internalAction({
  args: { sellerId: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sellers = (await ctx.runQuery(api.users.list, {})).filter(
      (user) =>
        user.role === "seller" &&
        (!args.sellerId || user._id === args.sellerId),
    );
    for (const seller of sellers) {
      const sales = await ctx.runQuery(
        api.storeSaleSettlement.listSellerSales,
        { sellerId: seller._id as Id<"users"> },
      );
      for (const sale of sales)
        await ctx.runAction(internal.sellerCostActions.reconcile, {
          paymentIntentId: sale.paymentIntentId,
        });
    }
    return null;
  },
});

/** Cost balance transactions can arrive after the original refund/dispute event. */
export const reconcileWhenReady = internalAction({
  args: { paymentIntentId: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 0;
    try {
      await ctx.runAction(internal.sellerCostActions.reconcile, {
        paymentIntentId: args.paymentIntentId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/Stripe (processing|refund) costs are not available yet|Sale settlement is not ready|Cost observation changed|Recovery revision cannot be reused/.test(
          message,
        ) ||
        attempt >= 10
      )
        throw error;
      await ctx.scheduler.runAfter(
        Math.min(60000, 1000 * 2 ** attempt),
        internal.sellerCostActions.reconcileWhenReady,
        { paymentIntentId: args.paymentIntentId, attempt: attempt + 1 },
      );
    }
    return null;
  },
});
