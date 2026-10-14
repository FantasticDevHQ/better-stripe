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
  operationVersion: v.optional(v.number()),
  operationPending: v.optional(v.boolean()),
  targetEnabled: v.optional(v.boolean()),
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
    if (existing) {
      if (existing.subscriptionId === args.subscriptionId) return null;
      await ctx.db.replace("storeBalanceFunding", existing._id, args);
    } else await ctx.db.insert("storeBalanceFunding", args);
    return null;
  },
});

/** A pending operation retains its identity across retries and host write failures. */
export const begin = internalMutation({
  args: {
    sellerId: v.id("users"),
    enabled: v.boolean(),
    consent: v.optional(v.literal(true)),
  },
  returns: v.union(
    v.object({ key: v.string(), version: v.number() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (args.enabled && !args.consent)
      throw new Error("Explicit consent is required.");
    const setting = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    if (!setting) throw new Error("Balance preparation is missing.");
    if (setting.operationPending && setting.targetEnabled !== args.enabled)
      throw new Error(
        "Another balance funding change is pending; retry it first.",
      );
    if (!setting.operationPending && setting.enabled === args.enabled)
      return null;
    const version = setting.operationPending
      ? setting.operationVersion!
      : (setting.operationVersion ?? 0) + 1;
    if (!setting.operationPending)
      await ctx.db.patch("storeBalanceFunding", setting._id, {
        operationVersion: version,
        operationPending: true,
        targetEnabled: args.enabled,
        ...(args.enabled ? { consentAt: Date.now() } : {}),
      });
    return {
      key: `example_balance_${setting.subscriptionId}_${version}`,
      version,
    };
  },
});
export const finish = internalMutation({
  args: { sellerId: v.id("users"), enabled: v.boolean(), version: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    if (
      !setting ||
      setting.operationVersion !== args.version ||
      setting.targetEnabled !== args.enabled
    )
      throw new Error(
        "Balance funding operation changed; reconcile before completing.",
      );
    await ctx.db.patch("storeBalanceFunding", setting._id, {
      enabled: args.enabled,
      operationPending: false,
    });
    return null;
  },
});
