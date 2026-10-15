import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { stripe } from "./stripe";
import { sellerCostDoc } from "./lib/sellerCostValidators";
import { costClaimKey, costScope } from "./lib/sellerRecovery";

export const legacyBatch = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.array(sellerCostDoc),
  handler: (ctx, args) =>
    ctx.db
      .query("sellerCosts")
      .withIndex("by_recovery_version", (q) =>
        q.eq("sellerId", args.sellerId).eq("recoveryVersion", undefined),
      )
      .take(20),
});
/** Caller verifies provider source economics before adopting a host-approved opening snapshot. */
export const adoptLegacy = internalMutation({
  args: {
    costId: v.id("sellerCosts"),
    sourceGross: v.number(),
    sourceProcessingFee: v.number(),
    expectedObservedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cost = await ctx.db.get("sellerCosts", args.costId);
    if (!cost) throw new Error("Legacy cost is unavailable.");
    const seller = await ctx.db.get("users", cost.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Choose the original seller for recovery migration.");
    const scope = costScope(seller._id, seller.stripeAccountId, cost.currency);
    const claimKey = costClaimKey(cost.paymentIntentId),
      operationKey = `example:cost-import:${cost._id}`;
    if (cost.recoveryVersion === 1) {
      if (
        cost.legacyObservedAt !== args.expectedObservedAt ||
        cost.sourceGross !== args.sourceGross ||
        cost.sourceProcessingFee !== args.sourceProcessingFee
      )
        throw new Error("Legacy opening snapshot cannot change.");
      const claim = await stripe.costRecovery.getClaim(ctx, { claimKey });
      if (!claim?.openingCollection)
        throw new Error("Legacy opening collection is unavailable.");
      await stripe.costRecovery.importClaim(ctx, {
        ...scope,
        claimKey,
        sourceChargeId: cost.sourceChargeId,
        sourceGross: args.sourceGross,
        sourceProcessingFee: args.sourceProcessingFee,
        ...claim.openingCollection,
        operationKey,
      });
      return null;
    }
    if (cost.observedAt !== args.expectedObservedAt)
      throw new Error("Legacy cost observation changed; reconcile again.");
    if (cost.invoicedAmount !== 0)
      throw new Error(
        "Verify the legacy invoice outcome before importing its held costs.",
      );
    for (const positive of [true, false]) {
      const pending = await ctx.db
        .query("storeSales")
        .withIndex("by_recovery", (q) => {
          const range = q
            .eq("sellerId", seller._id)
            .eq("currency", cost.currency)
            .eq("status", "pending");
          return positive
            ? range.gt("costRecoveryAmount", 0)
            : range
                .gte("costRecoveryAmount", Number.MIN_SAFE_INTEGER)
                .lt("costRecoveryAmount", 0);
        })
        .first();
      if (pending)
        throw new Error(
          "Verify the pending legacy payout before recovery migration.",
        );
    }
    const sale = await ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", cost.sourceChargeId))
      .first();
    if (
      sale &&
      (sale.sellerId !== seller._id ||
        sale.sellerAccountId !== seller.stripeAccountId ||
        sale.currency !== cost.currency ||
        sale.gross !== args.sourceGross ||
        sale.processingFee !== args.sourceProcessingFee)
    )
      throw new Error(
        "Legacy cost source identity does not match its original sale.",
      );
    await stripe.costRecovery.importClaim(ctx, {
      ...scope,
      claimKey,
      operationKey,
      sourceChargeId: cost.sourceChargeId,
      sourceGross: args.sourceGross,
      sourceProcessingFee: args.sourceProcessingFee,
      amountDue: cost.amountDue,
      collectedAmount: cost.collectedAmount,
      revision: 0,
    });
    await ctx.db.patch("sellerCosts", cost._id, {
      recoveryVersion: 1,
      legacyObservedAt: cost.observedAt,
      sourceGross: args.sourceGross,
      sourceProcessingFee: args.sourceProcessingFee,
    });
    return null;
  },
});
