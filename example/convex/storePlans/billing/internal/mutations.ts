import { v } from "convex/values";

import { internalMutation } from "../../../_generated/server";

import {
  storePlanIdValidator,
  storePlanRecordValidator,
} from "../../validators";

import { hasPaidStorePlan } from "../../helpers";

export const saveCatalogPrice = internalMutation({
  args: {
    planId: storePlanIdValidator,
    stripeProductId: v.string(),
    stripePriceId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storePlanCatalog")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .first();
    if (existing) await ctx.db.patch("storePlanCatalog", existing._id, args);
    else await ctx.db.insert("storePlanCatalog", args);
    return null;
  },
});

export const applyVerifiedSubscription = internalMutation({
  args: { sellerId: v.id("users"), storePlan: storePlanRecordValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller") throw new Error("Seller not found.");
    const current = seller.storePlan;
    if (
      current &&
      current.stripeSubscriptionId !== args.storePlan.stripeSubscriptionId &&
      hasPaidStorePlan(current)
    ) {
      throw new Error(
        "Another paid store subscription already exists. Manage the existing plan.",
      );
    }
    await ctx.db.patch("users", args.sellerId, { storePlan: args.storePlan });
    return null;
  },
});
