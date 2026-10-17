import { stripe } from "../../stripe/helpers";

import { prepareSaleRecovery } from "../recovery";

import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

import { internal } from "../../_generated/api";

import {
  storeSaleDocValidator,
  storeSaleFields,
} from "../../storePlans/validators";

export const reserve = internalMutation({
  args: storeSaleFields,
  returns: storeSaleDocValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .first();
    if (existing) return prepareSaleRecovery(ctx, existing);
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
    const id = await ctx.db.insert("storeSales", {
      ...args,
      costRecoveryAmount: 0,
      status: "pending",
    });
    return prepareSaleRecovery(ctx, (await ctx.db.get("storeSales", id))!);
  },
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
    if (
      sale.recoveryGroupKey &&
      (
        await stripe.costRecovery.getGroup(ctx, {
          groupKey: sale.recoveryGroupKey,
        })
      )?.status !== "collected"
    )
      throw new Error("Recovery collection is not complete.");
    await ctx.db.patch("storeSales", sale._id, { status: "settled" });
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
      !sale.settlementAttempted &&
      !sale.sellerTransferId &&
      !sale.affiliateTransferId
    ) {
      await ctx.db.patch("storeSales", sale._id, { status: "refunded" });
    }
    if (
      sale &&
      !sale.settlementAttempted &&
      sale.recoveryGroupKey &&
      sale.status !== "settled" &&
      sale.recoveryReady !== undefined
    ) {
      const job = await ctx.db
        .query("recoveryJobs")
        .withIndex("by_request", (q) =>
          q.eq("requestKey", `example:settlement-workflow:v1:${sale.chargeId}`),
        )
        .unique();
      // Cancellation holds the owning reservation. It never infers release from an observed refund.
      if (job) {
        if (job.operationId && job.version !== undefined)
          await stripe.costRecovery.requestGroupCancel(ctx, {
            accountId: job.accountId,
            scopeKey: job.scopeKey,
            currency: job.currency,
            groupKey: sale.recoveryGroupKey,
            operationId: job.operationId,
            version: job.version,
          });
        return null;
      }
      // Compatibility for a known pre-workflow reservation that was never dispatched.
      const result = await stripe.costRecovery.finish(ctx, {
        groupKey: sale.recoveryGroupKey,
        outcome: "release",
      });
      if (!result.isDone)
        await ctx.scheduler.runAfter(
          0,
          internal.settlement.internal.mutations.markUnpaidSaleRefunded,
          args,
        );
    }
    return null;
  },
});

export const prepareRecovery = internalMutation({
  args: { saleId: v.id("storeSales") },
  returns: storeSaleDocValidator,
  handler: async (ctx, args) => {
    const sale = await ctx.db.get("storeSales", args.saleId);
    if (!sale) throw new Error("Sale not found.");
    return prepareSaleRecovery(ctx, sale);
  },
});

export const beginAttempt = internalMutation({
  args: { saleId: v.id("storeSales") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sale = await ctx.db.get("storeSales", args.saleId);
    if (!sale?.recoveryReady || sale.status === "refunded")
      throw new Error("Sale allocation is not payable.");
    await ctx.db.patch("storeSales", sale._id, { settlementAttempted: true });
    return null;
  },
});

export const collectRecovery = internalMutation({
  args: { saleId: v.id("storeSales") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const sale = await ctx.db.get("storeSales", args.saleId);
    if (
      !sale?.settlementAttempted ||
      (sale.sellerNet > 0 && !sale.sellerTransferId) ||
      (sale.affiliateNet > 0 && !sale.affiliateTransferId)
    )
      throw new Error("Settlement has not confirmed its transfers.");
    if (!sale.recoveryGroupKey) return true;
    return (
      await stripe.costRecovery.finish(ctx, {
        groupKey: sale.recoveryGroupKey,
        outcome: "collect",
      })
    ).isDone;
  },
});
