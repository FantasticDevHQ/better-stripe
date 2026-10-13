import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import {
  storePlanIdValidator,
  storePlanRecordValidator,
} from "./lib/storePlanValidators";
import { hasPaidStorePlan } from "./lib/storePlans";

export const sellerValidator = v.object({
  sellerId: v.id("users"),
  name: v.string(),
  email: v.string(),
  stripeAccountId: v.optional(v.string()),
  storePlan: v.optional(storePlanRecordValidator),
});
export const getSeller = internalQuery({
  args: { sellerId: v.id("users") },
  returns: sellerValidator,
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to manage a store plan.");
    return {
      sellerId: seller._id,
      name: seller.storeName ?? seller.name,
      email: seller.email,
      stripeAccountId: seller.stripeAccountId,
      storePlan: seller.storePlan,
    };
  },
});
export const getState = query({
  args: { sellerId: v.id("users") },
  returns: v.object({
    storePlan: v.optional(storePlanRecordValidator),
    hasAccess: v.boolean(),
    stripeAccountId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to manage a store plan.");
    return {
      storePlan: seller.storePlan,
      hasAccess: hasPaidStorePlan(seller.storePlan),
      stripeAccountId: seller.stripeAccountId,
    };
  },
});
export const readCatalog = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      planId: storePlanIdValidator,
      stripeProductId: v.string(),
      stripePriceId: v.string(),
    }),
  ),
  handler: async (ctx) =>
    (await ctx.db.query("storePlanCatalog").take(3)).map(
      ({ planId, stripeProductId, stripePriceId }) => ({
        planId,
        stripeProductId,
        stripePriceId,
      }),
    ),
});
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
