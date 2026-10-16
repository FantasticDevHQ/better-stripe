import { v } from "convex/values";

import { internalMutation } from "../../../_generated/server";

import { validateFixedAffiliateAmount } from "../../helpers";

import { edit, validatePricing } from "../helpers";

export const publish = internalMutation({
  args: { ...edit, stripeProductId: v.string(), stripePriceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.adminId))?.role !== "admin")
      throw new Error("Only an admin can change store plan pricing.");
    validateFixedAffiliateAmount(args.affiliateFixedAmount);
    validatePricing(
      args.monthlyAmount,
      args.feeBasisPoints,
      args.affiliateBasisPoints,
    );
    const current = await ctx.db
      .query("storePlanSettings")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .first();
    if ((current?.version ?? 0) !== args.expectedVersion)
      throw new Error(
        "Pricing changed while you were editing. Reload and try again.",
      );
    const next = {
      planId: args.planId,
      monthlyAmount: args.monthlyAmount,
      feeBasisPoints: args.feeBasisPoints,
      affiliateCommissionTerm:
        args.affiliateCommissionTerm === undefined
          ? current?.affiliateCommissionTerm
          : args.affiliateCommissionTerm,
      affiliateBasisPoints:
        args.affiliateBasisPoints === undefined
          ? (current?.affiliateBasisPoints ?? null)
          : args.affiliateBasisPoints,
      affiliateFixedAmount:
        args.affiliateFixedAmount === undefined
          ? args.affiliateBasisPoints === undefined
            ? (current?.affiliateFixedAmount ?? null)
            : null
          : args.affiliateFixedAmount,
      version: args.expectedVersion + 1,
    };
    if (current) await ctx.db.patch("storePlanSettings", current._id, next);
    else await ctx.db.insert("storePlanSettings", next);
    const catalog = await ctx.db
      .query("storePlanCatalog")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .first();
    const entry = {
      planId: args.planId,
      stripeProductId: args.stripeProductId,
      stripePriceId: args.stripePriceId,
    };
    if (catalog) await ctx.db.patch("storePlanCatalog", catalog._id, entry);
    else await ctx.db.insert("storePlanCatalog", entry);
    return null;
  },
});
