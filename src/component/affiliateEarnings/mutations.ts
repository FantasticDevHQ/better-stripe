import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { earningFields } from "../affiliateRecovery/schema.js";
import {
  balance,
  changeBalance,
  due,
  updateObligation,
} from "../affiliateRecovery/accounting.js";
const earningDoc = v.object({
  ...earningFields,
  _id: v.id("affiliateEarnings"),
  _creationTime: v.number(),
});
export const reserveEarning = mutation({
  args: { sourceChargeId: v.string(), affiliateAccountId: v.string() },
  returns: earningDoc,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("affiliateEarnings")
      .withIndex("by_charge_affiliate", (q) =>
        q
          .eq("sourceChargeId", args.sourceChargeId)
          .eq("affiliateAccountId", args.affiliateAccountId),
      )
      .unique();
    if (existing) return existing;
    const allocation = await ctx.db
      .query("settlementAllocations")
      .withIndex("by_source_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .unique();
    const leg = allocation?.transfers.find(
      (t) =>
        t.role === "affiliate" &&
        t.destinationAccountId === args.affiliateAccountId,
    );
    if (!allocation || !leg)
      throw new Error(
        "Affiliate earning requires an immutable settlement allocation.",
      );
    const totals = await balance(
      ctx,
      args.affiliateAccountId,
      allocation.currency,
    );
    if (totals?.activePayoutKey)
      throw new Error("Affiliate payout is pending reconciliation.");
    if (
      (totals?.reservedRecovery ?? 0) > 0 ||
      (totals?.reservedRestoration ?? 0) > 0
    )
      throw new Error(
        "Affiliate provider recovery is pending reconciliation; retry settlement.",
      );
    const debts = await ctx.db
      .query("affiliateObligations")
      .withIndex("by_affiliate_currency_debt", (q) =>
        q
          .eq("affiliateAccountId", args.affiliateAccountId)
          .eq("currency", allocation.currency)
          .eq("debtStatus", "open"),
      )
      .take(1001);
    if (debts.length > 1000)
      throw new Error(
        "Affiliate debt batch limit exceeded; reconcile before releasing funds.",
      );
    let remaining = leg.amount;
    const offsets = [];
    for (const debt of debts) {
      if (
        debt.sourceChargeId === args.sourceChargeId ||
        debt.needsReconciliation
      )
        continue;
      if (debt.activeOperationId)
        throw new Error("Affiliate debt has an unresolved provider operation.");
      const amount = Math.min(remaining, due(debt));
      if (amount > 0) {
        offsets.push({ debt, amount });
        remaining -= amount;
      }
      if (!remaining) break;
    }
    const earningId = await ctx.db.insert("affiliateEarnings", {
      ...args,
      currency: allocation.currency,
      originalCommission: leg.amount,
      withheldAmount: leg.amount - remaining,
      releaseAmount: remaining,
      status: "reserved",
      sourceInvoiceId: allocation.sourceInvoiceId,
      paymentIntentId: allocation.paymentIntentId,
    });
    for (const { debt, amount } of offsets) {
      await ctx.db.insert("affiliateOffsets", {
        earningId,
        obligationId: debt._id,
        amount,
      });
      await updateObligation(ctx, debt, {
        offsetAmount: (debt.offsetAmount ?? 0) + amount,
        lastState: "offset",
      });
    }
    const obligationId = await ctx.db.insert("affiliateObligations", {
      sourceChargeId: allocation.sourceChargeId,
      sourceInvoiceId: allocation.sourceInvoiceId,
      paymentIntentId: allocation.paymentIntentId,
      paymentId: allocation.paymentId,
      storeAccountId: allocation.transfers.find((leg) => leg.role === "store")
        ?.destinationAccountId,
      affiliateAccountId: args.affiliateAccountId,
      currency: allocation.currency,
      chargeAmount: allocation.gross,
      originalCommission: leg.amount,
      releasedCommission: remaining,
      earningId,
      refundedPrincipal: 0,
      disputedPrincipal: 0,
      lostPrincipal: 0,
      finalizedAmount: 0,
      provisionalAmount: 0,
      recoveredAmount: 0,
      needsReconciliation: false,
    });
    await updateObligation(
      ctx,
      (await ctx.db.get("affiliateObligations", obligationId))!,
      {},
    );
    await changeBalance(ctx, args.affiliateAccountId, allocation.currency, {
      withheldAmount: leg.amount - remaining,
      netPayable: remaining,
    });
    return (await ctx.db.get("affiliateEarnings", earningId))!;
  },
});
export const confirmEarning = mutation({
  args: {
    earningId: v.id("affiliateEarnings"),
    stripeTransferId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const earning = await ctx.db.get("affiliateEarnings", args.earningId);
    if (!earning) throw new Error("Affiliate earning not found.");
    if (earning.status === "paid") {
      if (earning.stripeTransferId !== args.stripeTransferId)
        throw new Error("Affiliate earning receipt cannot change.");
      return null;
    }
    if (earning.releaseAmount > 0 !== !!args.stripeTransferId)
      throw new Error("Affiliate release requires an exact transfer receipt.");
    if (args.stripeTransferId) {
      const transfer = await ctx.db
        .query("transfers")
        .withIndex("by_stripe_transfer_id", (q) =>
          q.eq("stripeTransferId", args.stripeTransferId!),
        )
        .unique();
      if (
        !transfer ||
        transfer.amount !== earning.releaseAmount ||
        transfer.currency !== earning.currency ||
        transfer.destinationAccountId !== earning.affiliateAccountId ||
        transfer.sourceChargeId !== earning.sourceChargeId
      )
        throw new Error(
          "Affiliate release receipt does not match its earning.",
        );
    }
    const obligation = await ctx.db
      .query("affiliateObligations")
      .withIndex("by_charge", (q) =>
        q.eq("sourceChargeId", earning.sourceChargeId),
      )
      .take(1001);
    const own = obligation.find((row) => row.earningId === earning._id);
    if (!own || obligation.length > 1000)
      throw new Error("Affiliate earning obligation requires reconciliation.");
    await ctx.db.patch("affiliateObligations", own._id, {
      stripeTransferId: args.stripeTransferId,
    });
    await ctx.db.patch("affiliateEarnings", earning._id, {
      status: "paid",
      stripeTransferId: args.stripeTransferId,
    });
    await changeBalance(ctx, earning.affiliateAccountId, earning.currency, {
      netPayable: -earning.releaseAmount,
    });
    return null;
  },
});
