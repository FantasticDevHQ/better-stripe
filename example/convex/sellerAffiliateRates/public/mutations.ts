import { optionalCommissionTerm } from "../../marketplace/commission";

import { validateFixedAffiliateAmount } from "../../storePlans/helpers";

import { v } from "convex/values";

import { mutation } from "../../_generated/server";

import { readState, target } from "../helpers";

export const save = mutation({
  args: {
    ...target,
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.union(v.number(), v.null()),
    affiliateFixedAmount: v.optional(v.union(v.number(), v.null())),
    expectedVersion: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await readState(ctx, args);
    if (state.version !== args.expectedVersion)
      throw new Error(
        "Affiliate payout changed while editing. Reload and try again.",
      );
    const rate = args.affiliateBasisPoints;
    validateFixedAffiliateAmount(args.affiliateFixedAmount);
    if (args.affiliateFixedAmount != null && rate != null)
      throw new Error("Choose a percentage or a fixed payout, not both.");
    if (
      rate !== null &&
      (!Number.isSafeInteger(rate) || rate < 0 || rate > 10000)
    )
      throw new Error("Affiliate percentage must be between 0 and 100%.");
    const current = await ctx.db
      .query("sellerAffiliateRates")
      .withIndex("by_target", (q) =>
        q
          .eq("sellerId", args.sellerId)
          .eq("stripeProductId", args.stripeProductId)
          .eq("stripePriceId", args.stripePriceId),
      )
      .first();
    const next = {
      sellerId: args.sellerId,
      stripeProductId: args.stripeProductId,
      stripePriceId: args.stripePriceId,
      affiliateCommissionTerm:
        args.affiliateCommissionTerm === undefined
          ? current?.affiliateCommissionTerm
          : args.affiliateCommissionTerm,
      affiliateBasisPoints: rate,
      affiliateFixedAmount: args.affiliateFixedAmount ?? null,
      version: state.version + 1,
    };
    if (current) await ctx.db.patch("sellerAffiliateRates", current._id, next);
    else await ctx.db.insert("sellerAffiliateRates", next);
    return null;
  },
});
