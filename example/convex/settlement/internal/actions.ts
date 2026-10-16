import { stripe } from "../../stripe/helpers";

import { v } from "convex/values";

import { internalAction } from "../../_generated/server";

import { components, internal } from "../../_generated/api";

import { settleStoreSale, type StorePlanId } from "../../storePlans/helpers";

import type { Doc } from "../../_generated/dataModel";

/** All new example-store sales settle after Stripe reports the actual payment cost. */
export const settle = internalAction({
  args: {
    paymentIntentId: v.string(),
    subscriptionId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const verified = await stripe.getVerifiedSale(ctx, args);
    if (verified.status === "not_payable") return null;
    if (verified.status !== "ready")
      throw new Error(
        "Stripe processing fees are not available yet; retry settlement.",
      );
    const metadata = verified.metadata;
    if (metadata.storeBilling !== "sale_v1") return null;
    const prior: Doc<"storeSales"> | null = await ctx.runQuery(
      internal.settlement.internal.queries.getByCharge,
      { chargeId: verified.chargeId },
    );
    if (prior?.status === "settled" || prior?.status === "refunded")
      return null;
    const commission =
      args.subscriptionId && args.invoiceId
        ? await stripe.selectCommissionInvoice(ctx, {
            subscriptionId: args.subscriptionId,
            invoiceId: args.invoiceId,
            affiliateAccountId: metadata.affiliateAccountId || undefined,
            term:
              metadata.affiliateCommissionTerm === "one_time"
                ? "one_time"
                : "forever",
          })
        : null;
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      {
        sellerId:
          metadata.sellerId as import("../../_generated/dataModel").Id<"users">,
      },
    );
    if (!seller.stripeAccountId)
      throw new Error("Seller's Stripe account is unavailable.");
    // Existing customer renewals use the seller's current paid tier. If the store
    // is suspended, honor already-paid customer orders using its last paid tier.
    const planId = (seller.storePlan?.planId ?? metadata.planId) as StorePlanId;
    const plans = await ctx.runQuery(
      internal.storePlans.pricing.internal.queries.read,
      {},
    );
    const configuredPlan = plans.find((plan) => plan.id === planId);
    const stripePriceId = verified.stripePriceId;
    const affiliateRate = await ctx.runQuery(
      internal.sellerAffiliateRates.internal.queries.resolve,
      {
        sellerId: seller.sellerId,
        stripePriceId,
        stripeProductId: stripePriceId ? undefined : metadata.stripeProductId,
      },
    );
    const economics = settleStoreSale({
      gross: verified.gross,
      processingFee: verified.processingFee,
      planId,
      referred: commission
        ? commission.eligible
        : !!metadata.affiliateAccountId,
      feeBasisPoints: configuredPlan?.feeBasisPoints,
      affiliateBasisPoints: affiliateRate.effectiveBasisPoints,
      affiliateFixedAmount: affiliateRate.effectiveFixedAmount,
      currency: verified.currency,
    });
    await ctx.runAction(
      internal.sellerCosts.recoveryInvoices.actions.migrateLegacy,
      {
        sellerId: seller.sellerId,
      },
    );
    let sale: Doc<"storeSales"> = await ctx.runMutation(
      internal.settlement.internal.mutations.reserve,
      {
        ...economics,
        stripeSubscriptionId: args.subscriptionId,
        affiliateCommissionTerm:
          commission?.status === "ready" ? commission.term : "forever",
        affiliateBasisPoints:
          affiliateRate.effectiveFixedAmount == null
            ? affiliateRate.effectiveBasisPoints
            : undefined,
        affiliateFixedAmount: affiliateRate.effectiveFixedAmount ?? undefined,
        affiliateRateSource: affiliateRate.source,
        stripeProductId: affiliateRate.stripeProductId,
        stripePriceId: affiliateRate.stripePriceId,
        planId,
        chargeId: verified.chargeId,
        paymentIntentId: verified.paymentIntentId,
        sellerId: seller.sellerId,
        sellerAccountId: seller.stripeAccountId,
        currency: verified.currency,
        affiliateAccountId: metadata.affiliateAccountId || undefined,
        sourceInvoiceId: args.invoiceId,
      },
    );
    while (!sale.recoveryReady) {
      sale = await ctx.runMutation(
        internal.settlement.internal.mutations.prepareRecovery,
        { saleId: sale._id },
      );
    }
    await ctx.runMutation(internal.settlement.internal.mutations.beginAttempt, {
      saleId: sale._id,
    });
    const legs = [
      {
        role: "store" as const,
        amount: sale.sellerNet,
        destination: sale.sellerAccountId,
      },
      {
        role: "affiliate" as const,
        amount: sale.affiliateNet,
        destination: sale.affiliateAccountId,
      },
    ];
    const settlement = await stripe.settleSale(ctx, {
      ...args,
      allocation: {
        gross: sale.gross,
        currency: sale.currency,
        processingFee: sale.processingFee,
        platformNet: sale.platformNet,
        adjustmentAmount: sale.costRecoveryAmount ?? 0,
        transfers: legs
          .filter((leg) => leg.destination)
          .map((leg) => ({
            destinationAccountId: leg.destination!,
            role: leg.role,
            amount: leg.amount,
          })),
      },
    });
    if (!("executedTransfers" in settlement))
      throw new Error("Settlement is not ready.");
    for (const transfer of settlement.executedTransfers) {
      await ctx.runMutation(
        internal.settlement.internal.mutations.recordTransfer,
        {
          saleId: sale._id,
          role: transfer.role as "store" | "affiliate",
          transferId: transfer.stripeTransferId,
        },
      );
    }
    await ctx.runMutation(
      components.betterStripe.connect.mutations.upsertPayment,
      {
        stripePaymentIntentId: verified.paymentIntentId,
        userId: metadata.userId ?? "",
        amount: verified.gross,
        currency: verified.currency,
        status: "succeeded",
        destinationAccountId: sale.sellerAccountId,
        chargeType: "separate",
        feeCollectedAmount: sale.sellingFee,
        splitRecipients: legs
          .filter((l) => l.destination && l.amount > 0)
          .map((l) => ({
            destinationAccountId: l.destination!,
            amount: l.amount,
            role: l.role,
          })),
        metadata: {
          ...metadata,
          processingFee: String(sale.processingFee),
          platformNet: String(sale.platformNet),
          costRecoveryAmount: String(sale.costRecoveryAmount ?? 0),
        },
      },
    );
    while (
      !(await ctx.runMutation(
        internal.settlement.internal.mutations.collectRecovery,
        {
          saleId: sale._id,
        },
      ))
    ) {
      // Each call completes a bounded batch of reservations in a separate transaction.
    }
    await ctx.runMutation(internal.settlement.internal.mutations.markSettled, {
      saleId: sale._id,
    });
    return null;
  },
});

/** Stripe reports processing costs asynchronously, including in sandboxes. */
export const settleWhenReady = internalAction({
  args: {
    paymentIntentId: v.string(),
    subscriptionId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { attempt = 0, ...payment } = args;
    try {
      await ctx.runAction(internal.settlement.internal.actions.settle, payment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/processing fees are not available|Charge details are not ready/.test(
          message,
        ) ||
        attempt >= 10
      )
        throw error;
      await ctx.scheduler.runAfter(
        Math.min(60000, 1000 * 2 ** attempt),
        internal.settlement.internal.actions.settleWhenReady,
        { ...payment, attempt: attempt + 1 },
      );
    }
    return null;
  },
});
