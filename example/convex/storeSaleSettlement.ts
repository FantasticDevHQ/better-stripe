import { stripe } from "./stripe";
import { collectCostsForSale } from "./lib/sellerCostLedger";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal, components } from "./_generated/api";

import { settleStoreSale, type StorePlanId } from "./lib/storePlans";
import {
  storeSaleFields,
  storeSaleDocValidator,
} from "./lib/storePlanValidators";
import type { Doc } from "./_generated/dataModel";

export const reserve = internalMutation({
  args: storeSaleFields,
  returns: storeSaleDocValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .first();
    if (existing) return existing;
    const amounts = [
      args.gross,
      args.processingFee,
      args.sellingFee,
      args.platformNet,
      args.sellerNet,
      args.affiliateNet,
    ];
    if (
      amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      args.gross !==
        args.processingFee +
          args.platformNet +
          args.sellerNet +
          args.affiliateNet ||
      args.sellingFee !== args.processingFee + args.platformNet
    )
      throw new Error("Sale fees must reconcile without a platform subsidy.");
    const costRecoveryAmount = await collectCostsForSale(
      ctx,
      args.sellerId,
      args.currency,
      args.sellerNet,
      args.sellingFee,
    );
    const id = await ctx.db.insert("storeSales", {
      ...args,
      sellerNet: args.sellerNet - costRecoveryAmount,
      costRecoveryAmount,
      status: "pending",
    });
    return (await ctx.db.get("storeSales", id))!;
  },
});
export const getByCharge = internalQuery({
  args: { chargeId: v.string() },
  returns: v.union(storeSaleDocValidator, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .first(),
});
export const recordTransfer = internalMutation({
  args: {
    saleId: v.id("storeSales"),
    role: v.union(v.literal("store"), v.literal("affiliate")),
    transferId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sale = await ctx.db.get("storeSales", args.saleId);
    if (!sale) throw new Error("Sale not found.");
    const affiliate = args.role === "affiliate";
    const amount = affiliate ? sale.affiliateNet : sale.sellerNet;
    const destinationAccountId = affiliate
      ? sale.affiliateAccountId
      : sale.sellerAccountId;
    if (!destinationAccountId || amount <= 0)
      throw new Error("Invalid transfer leg.");
    await ctx.db.patch(
      "storeSales",
      sale._id,
      affiliate
        ? { affiliateTransferId: args.transferId }
        : { sellerTransferId: args.transferId },
    );
    return null;
  },
});
export const markSettled = internalMutation({
  args: { saleId: v.id("storeSales") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sale = await ctx.db.get("storeSales", args.saleId);
    if (
      !sale ||
      (sale.sellerNet > 0 && !sale.sellerTransferId) ||
      (sale.affiliateNet > 0 && !sale.affiliateTransferId)
    )
      throw new Error("Settlement still has unpaid transfer legs.");
    await ctx.db.patch("storeSales", sale._id, { status: "settled" });
    return null;
  },
});
export const listSellerSales = query({
  args: { sellerId: v.id("users") },
  returns: v.array(storeSaleDocValidator),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to view store sales.");
    return ctx.db
      .query("storeSales")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .order("desc")
      .take(100);
  },
});

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
      internal.storeSaleSettlement.getByCharge,
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
    const seller = await ctx.runQuery(internal.storePlanBilling.getSeller, {
      sellerId:
        metadata.sellerId as import("./_generated/dataModel").Id<"users">,
    });
    if (!seller.stripeAccountId)
      throw new Error("Seller's Stripe account is unavailable.");
    // Existing customer renewals use the seller's current paid tier. If the store
    // is suspended, honor already-paid customer orders using its last paid tier.
    const planId = (seller.storePlan?.planId ?? metadata.planId) as StorePlanId;
    const plans = await ctx.runQuery(internal.storePlanPricing.read, {});
    const configuredPlan = plans.find((plan) => plan.id === planId);
    const stripePriceId = verified.stripePriceId;
    const affiliateRate = await ctx.runQuery(
      internal.sellerAffiliateRates.resolve,
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
    const sale: Doc<"storeSales"> = await ctx.runMutation(
      internal.storeSaleSettlement.reserve,
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
      await ctx.runMutation(internal.storeSaleSettlement.recordTransfer, {
        saleId: sale._id,
        role: transfer.role as "store" | "affiliate",
        transferId: transfer.stripeTransferId,
      });
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
    await ctx.runMutation(internal.storeSaleSettlement.markSettled, {
      saleId: sale._id,
    });
    return null;
  },
});

export const markUnpaidSaleRefunded = internalMutation({
  args: { chargeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .first();
    if (
      sale?.status === "pending" &&
      !sale.sellerTransferId &&
      !sale.affiliateTransferId
    )
      await ctx.db.patch("storeSales", sale._id, { status: "refunded" });
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
      await ctx.runAction(internal.storeSaleSettlement.settle, payment);
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
        internal.storeSaleSettlement.settleWhenReady,
        { ...payment, attempt: attempt + 1 },
      );
    }
    return null;
  },
});
