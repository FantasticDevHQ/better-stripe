import {
  commissionTerm,
  optionalCommissionTerm,
} from "./lib/affiliateCommission";
import { storePayout, payoutSource } from "./affiliateDefaults";
import { validateFixedAffiliateAmount } from "./lib/storePlans";
import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
const target = {
  sellerId: v.id("users"),
  stripeProductId: v.string(),
  stripePriceId: v.optional(v.string()),
};
const stateValidator = v.object({
  affiliateCommissionTerm: optionalCommissionTerm,
  effectiveCommissionTerm: commissionTerm,
  affiliateBasisPoints: v.union(v.number(), v.null()),
  effectiveBasisPoints: v.number(),
  affiliateFixedAmount: v.union(v.number(), v.null()),
  effectiveFixedAmount: v.union(v.number(), v.null()),
  source: payoutSource,
  version: v.number(),
  stripeProductId: v.optional(v.string()),
  stripePriceId: v.optional(v.string()),
});
async function readState(
  ctx: QueryCtx,
  args: {
    sellerId: Id<"users">;
    stripeProductId?: string;
    stripePriceId?: string;
  },
) {
  const seller = await ctx.db.get("users", args.sellerId);
  if (seller?.role !== "seller" || !seller.stripeAccountId)
    throw new Error("Choose a seller with a Stripe account.");
  const base = await storePayout(ctx, seller);
  if (!args.stripeProductId && !args.stripePriceId)
    return { ...base, stripeProductId: undefined, stripePriceId: undefined };
  const price = args.stripePriceId
    ? await ctx.runQuery(
        components.betterStripe.products.queries.getPriceByStripeId,
        { stripePriceId: args.stripePriceId },
      )
    : null;
  if (args.stripePriceId && !price)
    throw new Error("Price is unavailable. Retry after product sync.");
  const stripeProductId = price?.stripeProductId ?? args.stripeProductId!;
  if (args.stripeProductId && args.stripeProductId !== stripeProductId)
    throw new Error("This price does not belong to the selected product.");
  const product = await ctx.runQuery(
    components.betterStripe.products.queries.getProductByStripeId,
    { stripeProductId },
  );
  if (product?.accountId !== seller.stripeAccountId)
    throw new Error(
      "You can only configure your own products and subscription prices.",
    );
  const productOverride = await ctx.db
    .query("sellerAffiliateRates")
    .withIndex("by_target", (q) =>
      q
        .eq("sellerId", args.sellerId)
        .eq("stripeProductId", stripeProductId)
        .eq("stripePriceId", undefined),
    )
    .first();
  const priceOverride = args.stripePriceId
    ? await ctx.db
        .query("sellerAffiliateRates")
        .withIndex("by_target", (q) =>
          q
            .eq("sellerId", args.sellerId)
            .eq("stripeProductId", stripeProductId)
            .eq("stripePriceId", args.stripePriceId),
        )
        .first()
    : null;
  const own = args.stripePriceId ? priceOverride : productOverride;
  const hasRule = (row: typeof productOverride) =>
    row?.affiliateFixedAmount != null || row?.affiliateBasisPoints != null;
  const effective = hasRule(priceOverride)
    ? priceOverride
    : hasRule(productOverride)
      ? productOverride
      : null;
  return {
    affiliateCommissionTerm: own?.affiliateCommissionTerm ?? null,
    effectiveCommissionTerm:
      priceOverride?.affiliateCommissionTerm ??
      productOverride?.affiliateCommissionTerm ??
      base.effectiveCommissionTerm,
    affiliateFixedAmount: own?.affiliateFixedAmount ?? null,
    effectiveFixedAmount: effective
      ? (effective.affiliateFixedAmount ?? null)
      : base.effectiveFixedAmount,
    affiliateBasisPoints: own?.affiliateBasisPoints ?? null,
    effectiveBasisPoints: effective
      ? (effective.affiliateBasisPoints ?? 0)
      : base.effectiveBasisPoints,
    source: hasRule(priceOverride)
      ? ("price" as const)
      : hasRule(productOverride)
        ? ("product" as const)
        : base.source,
    version: own?.version ?? 0,
    stripeProductId,
    stripePriceId: args.stripePriceId,
  };
}
export const get = query({
  args: target,
  returns: stateValidator,
  handler: readState,
});
export const resolve = internalQuery({
  args: {
    sellerId: v.id("users"),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
  },
  returns: stateValidator,
  handler: readState,
});
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
