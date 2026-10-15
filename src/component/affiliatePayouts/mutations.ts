import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { balance } from "../affiliateRecovery/accounting.js";
import { payoutReleaseFields } from "../affiliateRecovery/schema.js";
const doc = v.object({
  ...payoutReleaseFields,
  _id: v.id("affiliatePayoutReleases"),
  _creationTime: v.number(),
});
export const reservePayout = mutation({
  args: {
    affiliateAccountId: v.string(),
    currency: v.string(),
    amount: v.number(),
    minimumAmount: v.number(),
    operationKey: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.union(doc, v.null()),
  handler: async (ctx, args) => {
    const totals = await balance(ctx, args.affiliateAccountId, args.currency);
    if (!totals) return null;
    if (!args.operationKey?.trim())
      throw new Error("Affiliate payouts require a stable idempotency key.");
    const existing = await ctx.db
      .query("affiliatePayoutReleases")
      .withIndex("by_key", (q) => q.eq("operationKey", args.operationKey!))
      .unique();
    if (existing) {
      if (
        existing.amount !== args.amount ||
        existing.affiliateAccountId !== args.affiliateAccountId ||
        existing.currency !== args.currency ||
        existing.minimumAmount !== args.minimumAmount
      )
        throw new Error("Affiliate payout operation identity cannot change.");
      if (existing.state === "pending" || existing.state === "unknown") {
        if (
          totals.outstandingDebt > 0 ||
          totals.reservedRecovery > 0 ||
          totals.reservedRestoration > 0 ||
          totals.activePayoutKey !== existing.operationKey
        )
          throw new Error(
            "Affiliate recovery must be reconciled before payout release.",
          );
      }
      return existing;
    }
    if (
      ![args.amount, args.minimumAmount].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      args.amount < args.minimumAmount
    )
      throw new Error("Affiliate payout does not meet its currency minimum.");
    if (
      totals.outstandingDebt > 0 ||
      totals.reservedRecovery > 0 ||
      totals.reservedRestoration > 0 ||
      totals.activePayoutKey
    )
      throw new Error(
        "Affiliate recovery must be reconciled before payout release.",
      );
    const id = await ctx.db.insert("affiliatePayoutReleases", {
      affiliateAccountId: args.affiliateAccountId,
      currency: args.currency,
      amount: args.amount,
      minimumAmount: args.minimumAmount,
      operationKey: args.operationKey,
      createdAt: args.now,
      state: "pending",
    });
    await ctx.db.patch("affiliateRecoveryBalances", totals._id, {
      activePayoutKey: args.operationKey,
      pendingPayoutAmount: args.amount,
    });
    return (await ctx.db.get("affiliatePayoutReleases", id))!;
  },
});
export const finishPayout = mutation({
  args: {
    operationKey: v.string(),
    state: v.union(
      v.literal("unknown"),
      v.literal("submitted"),
      v.literal("failed"),
    ),
    stripePayoutId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("affiliatePayoutReleases")
      .withIndex("by_key", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (!row) throw new Error("Affiliate payout operation not found.");
    if (row.state === "submitted") {
      if (
        args.state === "submitted" &&
        args.stripePayoutId !== row.stripePayoutId
      )
        throw new Error("Affiliate payout receipt cannot change.");
      return null;
    }
    if (args.state === "submitted" && !args.stripePayoutId)
      throw new Error("Affiliate payout requires a provider receipt.");
    const totals = (await balance(ctx, row.affiliateAccountId, row.currency))!;
    if (args.state !== "unknown" && totals.activePayoutKey === row.operationKey)
      await ctx.db.patch("affiliateRecoveryBalances", totals._id, {
        activePayoutKey: undefined,
        pendingPayoutAmount: 0,
      });
    await ctx.db.patch("affiliatePayoutReleases", row._id, {
      state: args.state,
      stripePayoutId: args.stripePayoutId,
    });
    return null;
  },
});
