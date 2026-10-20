import { canonicalUsageSource } from "../../meteredProducts/settlementProof";
import { meteredSaleSource } from "../../meteredProducts/settlementSource";
import { env } from "../../_generated/server";
import {
  storeSalePolicyContext,
  matchesStoreSalePolicyContext,
} from "../workflow/helpers";
import {
  financialRetryDecision,
  readFinancialOutcomeError,
  throwFinancialOutcome,
  verifiedSaleOutcome,
} from "@fantastic.dev/better-stripe";
import { anyApi } from "convex/server";
import { stripe } from "../../stripe/helpers";

import { v } from "convex/values";

import { internalAction } from "../../_generated/server";

import { components, internal } from "../../_generated/api";

import { settleStoreSale, type StorePlanId } from "../../storePlans/helpers";

import type { Doc } from "../../_generated/dataModel";
import type { SettlementAuthorization } from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../../_generated/server";

/** Re-read the original sale and current seller mapping at each SDK write boundary. */
export function authorizeStoreSale(
  ctx: ActionCtx,
  sale: Doc<"storeSales">,
): SettlementAuthorization {
  return async (context) => {
    if (sale.usageSourceJson) {
      const proof = await meteredSaleSource(ctx, {
        paymentIntentId: sale.paymentIntentId,
        invoiceId: sale.sourceInvoiceId,
        subscriptionId: sale.stripeSubscriptionId,
      });
      if (
        !proof ||
        proof.verified.chargeId !== sale.chargeId ||
        proof.verified.paymentIntentId !== sale.paymentIntentId ||
        proof.verified.invoiceId !== sale.sourceInvoiceId ||
        proof.verified.gross !== sale.gross ||
        proof.verified.processingFee !== sale.processingFee ||
        proof.verified.currency !== sale.currency ||
        canonicalUsageSource(proof.usageSource) !==
          canonicalUsageSource(JSON.parse(sale.usageSourceJson)) ||
        canonicalUsageSource(context.settlement.usageSource) !==
          canonicalUsageSource(JSON.parse(sale.usageSourceJson))
      )
        throw new Error("Original metered settlement ownership changed.");
    }
    const current = await ctx.runQuery(
      internal.settlement.internal.queries.getByCharge,
      { chargeId: sale.chargeId },
    );
    const seller = await ctx.runQuery(
      internal.storePlans.billing.internal.queries.getSeller,
      { sellerId: sale.sellerId },
    );
    const source = context.settlement;
    if (!matchesStoreSalePolicyContext(sale, source.policyContext))
      throw new Error("Settlement authorization changed");
    if (
      !current ||
      current._id !== sale._id ||
      current.status === "refunded" ||
      current.sellerId !== sale.sellerId ||
      current.sellerAccountId !== seller.stripeAccountId ||
      source.sourceChargeId !== current.chargeId ||
      source.paymentIntentId !== current.paymentIntentId ||
      source.sourceInvoiceId !== current.sourceInvoiceId ||
      source.gross !== current.gross ||
      source.currency !== current.currency ||
      source.processingFee !== current.processingFee ||
      source.platformNet !== current.platformNet ||
      (source.adjustmentAmount ?? 0) !== (current.costRecoveryAmount ?? 0)
    )
      throw new Error("Settlement authorization changed");
    const legs =
      context.phase === "reserve"
        ? context.settlement.transfers
        : [context.transfer];
    if (
      legs.some((leg) =>
        leg.role === "store"
          ? leg.destinationAccountId !== current.sellerAccountId
          : leg.role !== "affiliate" ||
            leg.destinationAccountId !== current.affiliateAccountId,
      )
    )
      throw new Error("Settlement authorization changed");
    if (context.phase === "reserve") {
      if (
        context.settlement.transfers.some(
          (leg) =>
            leg.amount !==
            (leg.role === "store" ? current.sellerNet : current.affiliateNet),
        )
      )
        throw new Error("Settlement authorization changed");
      return;
    }
    if (context.transfer.role === "store") {
      if (context.transfer.amount !== current.sellerNet)
        throw new Error("Settlement authorization changed");
      return;
    }
    const earning = await ctx.runQuery(
      components.betterStripe.affiliateRecovery.queries.getEarning,
      {
        sourceChargeId: current.chargeId,
        affiliateAccountId: context.transfer.destinationAccountId,
      },
    );
    if (
      !earning ||
      earning.sourceChargeId !== current.chargeId ||
      earning.affiliateAccountId !== current.affiliateAccountId ||
      earning.currency !== current.currency ||
      earning.originalCommission !== current.affiliateNet ||
      !Number.isSafeInteger(earning.releaseAmount) ||
      earning.releaseAmount < 0 ||
      earning.releaseAmount > earning.originalCommission ||
      earning.withheldAmount !==
        earning.originalCommission - earning.releaseAmount ||
      context.transfer.amount !== earning.releaseAmount
    )
      throw new Error("Settlement authorization changed");
  };
}

/** All new example-store sales settle after Stripe reports the actual payment cost. */
export const settle = internalAction({
  args: {
    paymentIntentId: v.string(),
    subscriptionId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const metered =
      args.invoiceId && args.subscriptionId
        ? await meteredSaleSource(ctx, args)
        : undefined;
    if (metered === null) return null;
    const sourceArgs = metered
      ? {
          paymentIntentId: metered.verified.paymentIntentId,
          invoiceId: metered.verified.invoiceId,
          subscriptionId: metered.verified.subscriptionId,
        }
      : args;
    const verified =
      metered?.verified ?? (await stripe.getVerifiedSale(ctx, args));
    if (verified.status === "not_payable") return null;
    if (verified.status !== "ready") {
      throwFinancialOutcome(verifiedSaleOutcome(verified));
    }
    const metadata = verified.metadata;
    if (metadata.storeBilling !== "sale_v1") return null;
    const prior: Doc<"storeSales"> | null = await ctx.runQuery(
      internal.settlement.internal.queries.getByCharge,
      { chargeId: verified.chargeId },
    );
    if (prior?.status === "settled" || prior?.status === "refunded")
      return null;
    const commission =
      sourceArgs.subscriptionId && sourceArgs.invoiceId
        ? await stripe.selectCommissionInvoice(ctx, {
            subscriptionId: sourceArgs.subscriptionId,
            invoiceId: sourceArgs.invoiceId,
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
    // A mixed invoice has one product policy across its monthly and usage prices.
    const stripePriceId = metered ? undefined : verified.stripePriceId;
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
    const sale: Doc<"storeSales"> = await ctx.runMutation(
      internal.settlement.internal.mutations.reserve,
      {
        ...economics,
        ...(metered
          ? { usageSourceJson: JSON.stringify(metered.usageSource) }
          : {}),
        stripeSubscriptionId: sourceArgs.subscriptionId,
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
        sourceInvoiceId: sourceArgs.invoiceId,
      },
    );
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
    const operation = await ctx.runMutation(
      anyApi.settlement.workflow.mutations.start,
      { saleId: sale._id },
    );
    if (operation?.status === "no_owned_recovery") {
      // This sale owns no recovery reservation. Preserve the existing payout policy while another invoice holds the scope.
      await ctx.runMutation(
        internal.settlement.internal.mutations.beginAttempt,
        {
          saleId: sale._id,
        },
      );
      const allocation = {
        policyContext: storeSalePolicyContext(sale),
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
      };
      const settlement = metered
        ? await stripe.usage.settleInvoice(
            ctx,
            {
              ...metered.input,
              allocation,
              policy: { creatorAccountId: sale.sellerAccountId },
              authorize: authorizeStoreSale(ctx, sale),
            },
            { stripeSecretKey: env.STRIPE_SECRET_KEY },
          )
        : await stripe.settleSale(ctx, {
            ...sourceArgs,
            authorize: authorizeStoreSale(ctx, sale),
            allocation: {
              policyContext: storeSalePolicyContext(sale),
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
      if (!("executedTransfers" in settlement)) {
        if (
          settlement.status === "not_ready" ||
          settlement.status === "conflict" ||
          settlement.status === "rejected" ||
          settlement.status === "unknown"
        )
          throwFinancialOutcome(settlement);
        throwFinancialOutcome(
          verifiedSaleOutcome({
            status: settlement.status,
            reason: settlement.reason,
            retryable: "retryable" in settlement ? settlement.retryable : false,
          }),
        );
      }
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
        internal.settlement.internal.mutations.markSettled,
        { saleId: sale._id },
      );
    }
    return null;
  },
});

/** Retry ownership/economics preflight only. Component Workflow owns the authorized recovery execution. */
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
        internal.settlement.internal.actions.settleWhenReady,
        { ...payment, attempt: decision.nextAttempt },
      );
    }
    return null;
  },
});
