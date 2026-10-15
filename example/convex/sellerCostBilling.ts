import { costClaimKey, costScope } from "./lib/sellerRecovery";
import { stripe } from "./stripe";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { sellerCostDoc } from "./lib/sellerCostValidators";
export const record = internalMutation({
  args: {
    sellerId: v.id("users"),
    sourceChargeId: v.string(),
    paymentIntentId: v.string(),
    currency: v.string(),
    sourceType: v.optional(v.union(v.literal("refund"), v.literal("dispute"))),
    amountDue: v.number(),
    processingLoss: v.number(),
    disputeFees: v.number(),
    observedAt: v.number(),
    sourceGross: v.number(),
    sourceProcessingFee: v.number(),
    expectedRevision: v.number(),
    invoiceRecoveryGroupKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.amountDue) ||
      [args.processingLoss, args.disputeFees].some(
        (n) => !Number.isSafeInteger(n) || n < 0,
      )
    )
      throw new Error("Invalid seller cost.");
    const existing = await ctx.db
      .query("sellerCosts")
      .withIndex("by_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .first();
    if (
      existing &&
      (existing.sellerId !== args.sellerId ||
        existing.paymentIntentId !== args.paymentIntentId ||
        existing.currency !== args.currency)
    )
      throw new Error("Cost source ownership cannot change.");
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Original seller account is unavailable.");
    const scope = costScope(seller._id, seller.stripeAccountId, args.currency);
    const claimKey = costClaimKey(args.paymentIntentId);
    const { expectedRevision, ...metadata } = args;
    let claim = await stripe.costRecovery.getClaim(ctx, { claimKey });
    if ((claim?.revision ?? -1) !== expectedRevision)
      throw new Error("Cost observation changed; reconcile again.");
    if (existing && existing.recoveryVersion !== 1) {
      await ctx.runMutation(internal.recoveryMigration.adoptLegacy, {
        costId: existing._id,
        sourceGross: args.sourceGross,
        sourceProcessingFee: args.sourceProcessingFee,
        expectedObservedAt: existing.observedAt,
      });
      claim = await stripe.costRecovery.getClaim(ctx, { claimKey });
    }
    await stripe.costRecovery.recordClaim(ctx, {
      ...scope,
      claimKey,
      sourceChargeId: args.sourceChargeId,
      sourceGross: args.sourceGross,
      sourceProcessingFee: args.sourceProcessingFee,
      amountDue: args.amountDue,
      revision: (claim?.revision ?? -1) + 1,
    });
    if (existing)
      await ctx.db.patch("sellerCosts", existing._id, {
        ...metadata,
        recoveryVersion: 1,
      });
    else
      await ctx.db.insert("sellerCosts", {
        ...metadata,
        recoveryVersion: 1,
        collectedAmount: 0,
        invoicedAmount: 0,
        outstanding: args.amountDue,
        open: args.amountDue !== 0,
      });
    return null;
  },
});
export const list = query({
  args: { sellerId: v.id("users") },
  returns: v.array(sellerCostDoc),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.sellerId))?.role !== "seller")
      throw new Error("Choose a seller to view costs.");
    const seller = await ctx.db.get("users", args.sellerId);
    const rows = await ctx.db
      .query("sellerCosts")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .order("desc")
      .take(100);
    return Promise.all(
      rows.map(async (row) => {
        if (row.recoveryVersion !== 1) return row;
        const claim = await stripe.costRecovery.getClaim(ctx, {
          claimKey: costClaimKey(row.paymentIntentId),
        });
        if (!claim || claim.accountId !== seller?.stripeAccountId)
          throw new Error("Recovery claim ownership is unavailable.");
        const rollback = await stripe.costRecovery.getClaim(ctx, {
          claimKey: `rollback:${row.invoiceRecoveryGroupKey ?? `example:cost-settlement:${row.sourceChargeId}`}`,
        });
        const amountDue = claim.amountDue + (rollback?.amountDue ?? 0),
          collectedAmount =
            claim.collectedAmount + (rollback?.collectedAmount ?? 0),
          reservedAmount =
            claim.reservedAmount + (rollback?.reservedAmount ?? 0),
          outstanding = claim.outstanding + (rollback?.outstanding ?? 0);
        return {
          ...row,
          amountDue,
          collectedAmount,
          invoicedAmount: reservedAmount,
          reservedAmount,
          outstanding,
          open: outstanding !== 0,
        };
      }),
    );
  },
});
