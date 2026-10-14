import { collectCostsForSale } from "./lib/sellerCostLedger";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal, components } from "./_generated/api";
import { getStripeClient } from "./lib/stripeClient";
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
    await ctx.runMutation(
      components.betterStripe.connect.mutations.upsertTransfer,
      {
        stripeTransferId: args.transferId,
        sourceChargeId: sale.chargeId,
        sourceInvoiceId: sale.sourceInvoiceId,
        destinationAccountId,
        amount,
        currency: sale.currency,
        role: args.role,
        status: "paid",
        metadata: { storePlanId: sale.planId },
      },
    );
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
    const raw = getStripeClient();
    const payment = await raw.paymentIntents.retrieve(args.paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const subscription = args.subscriptionId
      ? await raw.subscriptions.retrieve(args.subscriptionId)
      : null;
    const metadata = subscription?.metadata ?? payment.metadata;
    if (metadata.storeBilling !== "sale_v1" || payment.status !== "succeeded")
      return null;
    const charge = payment.latest_charge;
    if (!charge || typeof charge === "string")
      throw new Error("Charge details are not ready; retry settlement.");
    const prior: Doc<"storeSales"> | null = await ctx.runQuery(
      internal.storeSaleSettlement.getByCharge,
      { chargeId: charge.id },
    );
    if (prior?.status === "settled" || prior?.status === "refunded")
      return null;
    if (charge.amount_refunded > 0)
      throw new Error(
        "Refunded charge requires settlement review before paying recipients.",
      );
    const balance = charge.balance_transaction;
    if (!balance || typeof balance === "string")
      throw new Error(
        "Stripe processing fees are not available yet; retry settlement.",
      );
    if (balance.currency !== payment.currency)
      throw new Error(
        "Settlement currency must match the store sale currency.",
      );
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
    const stripePriceId =
      subscription?.items?.data[0]?.price.id ?? metadata.stripePriceId;
    const affiliateRate = await ctx.runQuery(
      internal.sellerAffiliateRates.resolve,
      {
        sellerId: seller.sellerId,
        stripePriceId,
        stripeProductId: stripePriceId ? undefined : metadata.stripeProductId,
      },
    );
    const economics = settleStoreSale({
      gross: payment.amount_received,
      processingFee: balance.fee,
      planId,
      referred: !!metadata.affiliateAccountId,
      feeBasisPoints: configuredPlan?.feeBasisPoints,
      affiliateBasisPoints: affiliateRate.effectiveBasisPoints,
      affiliateFixedAmount: affiliateRate.effectiveFixedAmount,
      currency: payment.currency,
    });
    const sale: Doc<"storeSales"> = await ctx.runMutation(
      internal.storeSaleSettlement.reserve,
      {
        ...economics,
        affiliateBasisPoints:
          affiliateRate.effectiveFixedAmount == null
            ? affiliateRate.effectiveBasisPoints
            : undefined,
        affiliateFixedAmount: affiliateRate.effectiveFixedAmount ?? undefined,
        affiliateRateSource: affiliateRate.source,
        stripeProductId: affiliateRate.stripeProductId,
        stripePriceId: affiliateRate.stripePriceId,
        planId,
        chargeId: charge.id,
        paymentIntentId: payment.id,
        sellerId: seller.sellerId,
        sellerAccountId: seller.stripeAccountId,
        currency: payment.currency,
        affiliateAccountId: metadata.affiliateAccountId || undefined,
        sourceInvoiceId: args.invoiceId,
      },
    );
    const existing = await raw.transfers.list({
      transfer_group: charge.id,
      limit: 100,
    });
    const legs = [
      {
        role: "store" as const,
        amount: sale.sellerNet,
        destination: sale.sellerAccountId,
        id: sale.sellerTransferId,
      },
      {
        role: "affiliate" as const,
        amount: sale.affiliateNet,
        destination: sale.affiliateAccountId,
        id: sale.affiliateTransferId,
      },
    ];
    for (const leg of legs) {
      if (!leg.destination || leg.amount === 0 || leg.id) continue;
      // Reconcile Stripe before retrying, even after its idempotency cache expires.
      const recovered = existing.data.find(
        (t) =>
          t.metadata.storeSaleChargeId === charge.id &&
          t.metadata.role === leg.role &&
          t.amount === leg.amount &&
          (typeof t.destination === "string"
            ? t.destination
            : t.destination?.id) === leg.destination,
      );
      const transfer =
        recovered ??
        (await raw.transfers.create(
          {
            amount: leg.amount,
            currency: sale.currency,
            destination: leg.destination,
            source_transaction: charge.id,
            transfer_group: charge.id,
            metadata: {
              storeSaleChargeId: charge.id,
              role: leg.role,
              storePlanId: sale.planId,
            },
          },
          { idempotencyKey: `example_store_sale_${charge.id}_${leg.role}` },
        ));
      await ctx.runMutation(internal.storeSaleSettlement.recordTransfer, {
        saleId: sale._id,
        role: leg.role,
        transferId: transfer.id,
      });
    }
    await ctx.runMutation(
      components.betterStripe.connect.mutations.upsertPayment,
      {
        stripePaymentIntentId: payment.id,
        userId: metadata.userId ?? "",
        amount: payment.amount_received,
        currency: payment.currency,
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
