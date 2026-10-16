import {
  commissionTerm,
  optionalCommissionTerm,
} from "../marketplace/commission";

import { v } from "convex/values";

import { type QueryCtx } from "../_generated/server";

import type { Doc } from "../_generated/dataModel";

export const payoutSource = v.union(
  v.literal("global"),
  v.literal("store"),
  v.literal("plan"),
  v.literal("product"),
  v.literal("price"),
  v.literal("none"),
);

export const hasPayout = (
  row:
    | {
        affiliateBasisPoints?: number | null;
        affiliateFixedAmount?: number | null;
      }
    | null
    | undefined,
) => row?.affiliateBasisPoints != null || row?.affiliateFixedAmount != null;

export async function platformPayout(ctx: QueryCtx) {
  const row = await ctx.db
    .query("affiliateDefaults")
    .withIndex("by_seller", (q) => q.eq("sellerId", undefined))
    .first();
  return {
    affiliateCommissionTerm: row?.affiliateCommissionTerm ?? null,
    effectiveCommissionTerm:
      row?.affiliateCommissionTerm ?? ("forever" as const),
    affiliateBasisPoints: row?.affiliateBasisPoints ?? null,
    affiliateFixedAmount: row?.affiliateFixedAmount ?? null,
    effectiveBasisPoints: row?.affiliateBasisPoints ?? 0,
    effectiveFixedAmount: row?.affiliateFixedAmount ?? null,
    source: hasPayout(row) ? ("global" as const) : ("none" as const),
    version: row?.version ?? 0,
  };
}

export async function storePayout(ctx: QueryCtx, seller: Doc<"users">) {
  const global = await platformPayout(ctx);
  const store = await ctx.db
    .query("affiliateDefaults")
    .withIndex("by_seller", (q) => q.eq("sellerId", seller._id))
    .first();
  const plan = seller.storePlan
    ? await ctx.db
        .query("storePlanSettings")
        .withIndex("by_plan", (q) => q.eq("planId", seller.storePlan!.planId))
        .first()
    : null;
  const effective = hasPayout(store) ? store : hasPayout(plan) ? plan : null;
  return {
    affiliateCommissionTerm: store?.affiliateCommissionTerm ?? null,
    effectiveCommissionTerm:
      store?.affiliateCommissionTerm ??
      plan?.affiliateCommissionTerm ??
      global.effectiveCommissionTerm,
    affiliateBasisPoints: store?.affiliateBasisPoints ?? null,
    affiliateFixedAmount: store?.affiliateFixedAmount ?? null,
    effectiveBasisPoints: effective
      ? (effective.affiliateBasisPoints ?? 0)
      : global.effectiveBasisPoints,
    effectiveFixedAmount: effective
      ? (effective.affiliateFixedAmount ?? null)
      : global.effectiveFixedAmount,
    source: hasPayout(store)
      ? ("store" as const)
      : hasPayout(plan)
        ? ("plan" as const)
        : global.source,
    version: store?.version ?? 0,
  };
}

export const state = v.object({
  affiliateCommissionTerm: optionalCommissionTerm,
  effectiveCommissionTerm: commissionTerm,
  affiliateBasisPoints: v.union(v.number(), v.null()),
  affiliateFixedAmount: v.union(v.number(), v.null()),
  effectiveBasisPoints: v.number(),
  effectiveFixedAmount: v.union(v.number(), v.null()),
  source: payoutSource,
  version: v.number(),
});
