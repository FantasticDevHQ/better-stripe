import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
const fields = {
  sellerId: v.id("users"),
  subscriptionId: v.string(),
  enabled: v.boolean(),
  paymentMethodId: v.string(),
  previousPaymentMethodId: v.optional(v.string()),
  previousPaymentMethodTypes: v.optional(v.array(v.string())),
  consentAt: v.number(),
};
const doc = v.object({
  ...fields,
  _id: v.id("storeBalanceFunding"),
  _creationTime: v.number(),
});
export const read = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.union(doc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first(),
});
export const state = query({
  args: { sellerId: v.id("users") },
  returns: v.object({
    enabled: v.boolean(),
    consentAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.sellerId))?.role !== "seller")
      throw new Error("Choose a seller to manage payment sources.");
    const setting = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    return {
      enabled: setting?.enabled ?? false,
      consentAt: setting?.consentAt,
    };
  },
});
export const save = internalMutation({
  args: fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    if (existing)
      await ctx.db.replace("storeBalanceFunding", existing._id, args);
    else await ctx.db.insert("storeBalanceFunding", args);
    return null;
  },
});
