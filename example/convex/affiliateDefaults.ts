import { v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validateFixedAffiliateAmount } from "./lib/storePlans";
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
const state = v.object({
  affiliateBasisPoints: v.union(v.number(), v.null()),
  affiliateFixedAmount: v.union(v.number(), v.null()),
  effectiveBasisPoints: v.number(),
  effectiveFixedAmount: v.union(v.number(), v.null()),
  source: payoutSource,
  version: v.number(),
});
export const get = query({
  args: { sellerId: v.optional(v.id("users")) },
  returns: state,
  handler: async (ctx, args) => {
    if (!args.sellerId) return platformPayout(ctx);
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller") throw new Error("Choose a seller.");
    return storePayout(ctx, seller);
  },
});
export const save = mutation({
  args: {
    actorId: v.id("users"),
    sellerId: v.optional(v.id("users")),
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
      affiliateBasisPoints: rate,
      affiliateFixedAmount: args.affiliateFixedAmount,
      version: args.expectedVersion + 1,
    };
    if (current) await ctx.db.patch("affiliateDefaults", current._id, next);
    else await ctx.db.insert("affiliateDefaults", next);
    return null;
  },
});
