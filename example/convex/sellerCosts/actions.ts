import {
  financialRetryDecision,
  processingCostOutcome,
  readFinancialOutcomeError,
  throwFinancialOutcome,
} from "@fantastic.dev/better-stripe";
import { reconcileInvoiceFunding } from "./invoiceRecoverySource";

import { unsettledCostSource } from "./unsettledCostSource";

import { stripe } from "../stripe/helpers";

import { v } from "convex/values";

import { internalAction } from "../_generated/server";

import { api, internal } from "../_generated/api";

import { anyApi } from "convex/server";
import { getStripeClient } from "../stripe/client";

import type { Id } from "../_generated/dataModel";

export const reconcile = internalAction({
  args: { paymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // This bounded read routes ownership only. The component re-observes authoritative costs before writing.
    const cost = await stripe.getProcessingCostContext(ctx, {
      ...args,
      historyBounds: { maxPages: 5, maxItems: 500 },
    });
    if (cost.status !== "ready") {
      if (
        cost.reason === "payment_not_succeeded" ||
        cost.reason === "charge_unavailable"
      )
        return null;
      throwFinancialOutcome(processingCostOutcome(cost));
    }
    const settled = await ctx.runQuery(
      internal.settlement.internal.queries.getByCharge,
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
        internal.settlement.internal.mutations.markUnpaidSaleRefunded,
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
    const payment = await getStripeClient().paymentIntents.retrieve(
      args.paymentIntentId,
    );
    if (payment.id !== args.paymentIntentId || !payment.customer_account)
      throw new Error("Original customer account is unavailable.");
    await ctx.runMutation(anyApi.sellerCosts.workflow.mutations.start, {
      sellerId: sale.sellerId,
      sourceChargeId: cost.chargeId,
      paymentIntentId: cost.paymentIntentId,
      currency: sale.currency,
      gross: cost.gross,
      originalProcessingFee: cost.processingFee,
      sellingFee: sale.sellingFee,
      customerAccountId: payment.customer_account,
      sourceType: cost.disputes.length ? "dispute" : "refund",
      ...("stripePriceId" in sale && sale.stripePriceId !== undefined
        ? { stripePriceId: sale.stripePriceId }
        : {}),
      ...("stripeProductId" in sale && sale.stripeProductId !== undefined
        ? { stripeProductId: sale.stripeProductId }
        : {}),
      ...(settled?.sourceInvoiceId
        ? { invoiceId: settled.sourceInvoiceId }
        : {}),
      ...(invoiceSource?.invoiceRecoveryGroupKey
        ? { invoiceRecoveryGroupKey: invoiceSource.invoiceRecoveryGroupKey }
        : {}),
    });
    return null;
  },
});

export const attachToInvoice = internalAction({
  args: { invoiceId: v.string(), sellerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runAction(
      internal.sellerCosts.recoveryInvoices.actions.attach,
      args,
    );
    return null;
  },
});

/** Reconcile already-existing example sales after adding cost recovery. */
export const reconcileExisting = internalAction({
  args: { sellerId: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sellers = (await ctx.runQuery(api.users.queries.list, {})).filter(
      (user) =>
        user.role === "seller" &&
        (!args.sellerId || user._id === args.sellerId),
    );
    for (const seller of sellers) {
      const sales = await ctx.runQuery(
        api.settlement.public.queries.listSellerSales,
        { sellerId: seller._id as Id<"users"> },
      );
      for (const sale of sales)
        await ctx.runAction(internal.sellerCosts.actions.reconcileWhenReady, {
          paymentIntentId: sale.paymentIntentId,
        });
    }
    return null;
  },
});

/** Retry only ownership preflight. Once authorized, the component owns observation retries and revisions. */
export const reconcileWhenReady = internalAction({
  args: { paymentIntentId: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 0;
    try {
      await ctx.runAction(internal.sellerCosts.actions.reconcile, {
        paymentIntentId: args.paymentIntentId,
      });
    } catch (error) {
      const outcome = readFinancialOutcomeError(error);
      if (!outcome) throw error;
      const decision = financialRetryDecision(outcome, attempt, {
        maxRetries: 10,
        initialDelayMs: 1000,
        maxDelayMs: 60000,
      });
      if (decision.status === "stop") throw error;
      await ctx.scheduler.runAfter(
        decision.delayMs,
        internal.sellerCosts.actions.reconcileWhenReady,
        {
          paymentIntentId: args.paymentIntentId,
          attempt: decision.nextAttempt,
        },
      );
    }
    return null;
  },
});
