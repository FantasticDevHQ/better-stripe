import { optionalCommissionTerm } from "../marketplace/commission";

import { v } from "convex/values";

import { mutation } from "../_generated/server";

import { validateFixedAffiliateAmount } from "../storePlans/helpers";

export const save = mutation({
  args: {
    actorId: v.id("users"),
    sellerId: v.optional(v.id("users")),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.union(v.number(), v.null()),
    affiliateFixedAmount: v.union(v.number(), v.null()),
    expectedVersion: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await ctx.db.get("users", args.actorId);
    if (
      args.sellerId
        ? actor?.role !== "seller" || actor._id !== args.sellerId
        : actor?.role !== "admin"
    )
      throw new Error(
        args.sellerId
          ? "Only the store owner can change its default."
          : "Only an admin can change the global default.",
      );
    const rate = args.affiliateBasisPoints;
    if (
      rate !== null &&
      (!Number.isSafeInteger(rate) || rate < 0 || rate > 10000)
    )
      throw new Error("Affiliate percentage must be between 0 and 100%.");
    validateFixedAffiliateAmount(args.affiliateFixedAmount);
    if (rate != null && args.affiliateFixedAmount != null)
      throw new Error("Choose a percentage or fixed amount.");
    const current = await ctx.db
      .query("affiliateDefaults")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    if ((current?.version ?? 0) !== args.expectedVersion)
      throw new Error(
        "Affiliate default changed while editing. Reload and try again.",
      );
    const next = {
      sellerId: args.sellerId,
      affiliateCommissionTerm:
        args.affiliateCommissionTerm === undefined
          ? current?.affiliateCommissionTerm
          : args.affiliateCommissionTerm,
      affiliateBasisPoints: rate,
      affiliateFixedAmount: args.affiliateFixedAmount,
      version: args.expectedVersion + 1,
    };
    if (current) await ctx.db.patch("affiliateDefaults", current._id, next);
    else await ctx.db.insert("affiliateDefaults", next);
    return null;
  },
});
