import {
  commissionTerm,
  optionalCommissionTerm,
} from "../marketplace/commission";

import { payoutSource, storePayout } from "../affiliateDefaults/helpers";

import { v } from "convex/values";

import { type QueryCtx } from "../_generated/server";

import { components } from "../_generated/api";

import type { Id } from "../_generated/dataModel";

export const target = {
  sellerId: v.id("users"),
  stripeProductId: v.string(),
  stripePriceId: v.optional(v.string()),
};

export const stateValidator = v.object({
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

export async function readState(
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
