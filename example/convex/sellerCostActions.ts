import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getStripeClient } from "./lib/stripeClient";
import { stripeCostDeficit } from "./lib/sellerCosts";
import type { Id } from "./_generated/dataModel";

export const reconcile = internalAction({
  args: { paymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const observedAt = Date.now();
    const raw = getStripeClient();
    const payment = await raw.paymentIntents.retrieve(args.paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string") return null;
    const sale = await ctx.runQuery(internal.storeSaleSettlement.getByCharge, {
      chargeId: charge.id,
    });
    if (!sale) {
      if (
        payment.metadata?.storeBilling === "sale_v1" &&
        payment.status === "succeeded"
      )
        throw new Error(
          "Sale settlement is not ready for cost reconciliation.",
        );
      return null;
    }
    const balance = charge.balance_transaction;
    if (!balance || typeof balance === "string")
      throw new Error("Stripe processing costs are not available yet.");
    const refunds = await raw.refunds.list({
      payment_intent: payment.id,
      limit: 100,
      expand: ["data.balance_transaction"],
    });
    let refundFeeCredits = 0;
    for (const refund of refunds.data) {
      if (refund.status !== "succeeded") continue;
      const transaction = refund.balance_transaction;
      if (!transaction || typeof transaction === "string")
        throw new Error("Stripe refund costs are not available yet.");
      refundFeeCredits += transaction.fee;
    }
    const disputes = await raw.disputes.list({
      payment_intent: payment.id,
      limit: 100,
    });
    const disputePrincipal = disputes.data.reduce(
      (sum, dispute) =>
        sum +
        Math.max(
          0,
          -dispute.balance_transactions.reduce(
            (total, t) => total + t.amount,
            0,
          ),
        ),
      0,
    );
    const disputeFees = Math.max(
      0,
      disputes.data.reduce(
        (sum, dispute) =>
          sum +
          dispute.balance_transactions.reduce((total, t) => total + t.fee, 0),
        0,
      ),
    );
    const principalReturned = Math.min(
      sale.gross,
      charge.amount_refunded + disputePrincipal,
    );
    const processingFee = Math.max(0, balance.fee + refundFeeCredits);
    const processingLoss = stripeCostDeficit({
      gross: sale.gross,
      sellingFee: sale.sellingFee,
      processingFee,
      principalReturned,
      disputeFees: 0,
    });
    // Returning a payment also returns any previous cost adjustment funded by
    // that payment. Reinstate that adjustment so old expenses aren't forgiven.
    const adjustmentRollback = Math.round(
      ((sale.costRecoveryAmount ?? 0) * principalReturned) / sale.gross,
    );
    await ctx.runMutation(internal.sellerCostBilling.record, {
      sellerId: sale.sellerId,
      sourceChargeId: charge.id,
      paymentIntentId: payment.id,
      currency: sale.currency,
      sourceType: disputes.data.length ? "dispute" : "refund",
      amountDue: processingLoss + disputeFees + adjustmentRollback,
      processingLoss,
      disputeFees,
      observedAt,
    });
    return null;
  },
});

export const attachToInvoice = internalAction({
  args: { invoiceId: v.string(), sellerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const raw = getStripeClient();
    const invoice = await raw.invoices.retrieve(args.invoiceId);
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId: args.sellerId,
    });
    if (invoice.customer_account !== seller.stripeAccountId)
      throw new Error("Cost invoice belongs to another Stripe account.");
    const previous = await ctx.runQuery(internal.sellerCostBilling.getBill, {
      invoiceId: invoice.id,
    });
    if (previous?.status === "attached") return null;
    if (invoice.status !== "draft")
      throw new Error(
        "Seller costs must be attached before the monthly invoice is finalized.",
      );
    const bill = await ctx.runMutation(
      internal.sellerCostBilling.claimInvoice,
      {
        sellerId: seller.sellerId,
        invoiceId: invoice.id,
        currency: invoice.currency,
      },
    );
    if (!bill) return null;
    if (bill.amount === 0) {
      await ctx.runMutation(internal.sellerCostBilling.markAttached, {
        billId: bill._id,
      });
      return null;
    }
    const key = `example_seller_cost_bill_${bill._id}`;
    const items = await raw.invoiceItems.list({
      customer_account: seller.stripeAccountId,
      limit: 100,
    });
    const existing = items.data.find(
      (item) => item.metadata?.sellerCostBill === bill._id,
    );
    const item =
      existing ??
      (await raw.invoiceItems.create(
        {
          customer_account: seller.stripeAccountId,
          invoice: invoice.id,
          amount: bill.amount,
          currency: bill.currency,
          description:
            bill.amount > 0
              ? "Unrecovered Stripe costs from refunds and disputes"
              : "Credit for returned Stripe costs",
          metadata: { sellerCostBill: bill._id, sellerId: seller.sellerId },
        },
        { idempotencyKey: key },
      ));
    await ctx.runMutation(internal.sellerCostBilling.markAttached, {
      billId: bill._id,
      stripeInvoiceItemId: item.id,
    });
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
        !/Stripe (processing|refund) costs are not available yet|Sale settlement is not ready/.test(
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
