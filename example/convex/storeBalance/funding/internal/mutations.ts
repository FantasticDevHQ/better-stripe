import { v } from "convex/values";

import { internalMutation } from "../../../_generated/server";
import { fields } from "../helpers";

export const save = internalMutation({
  args: fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      await ctx.db
        .query("storeBalanceMigrationRuns")
        .withIndex("by_key", (q) => q.eq("key", "component-cutover"))
        .unique()
    )
      throw new Error(
        "Legacy balance funding starts are fenced by the cutover checkpoint.",
      );
    const existing = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    if (existing) {
      if (existing.migrationPaused || existing.componentMigration)
        throw new Error("Legacy balance funding is paused for migration.");
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
    if (
      await ctx.db
        .query("storeBalanceMigrationRuns")
        .withIndex("by_key", (q) => q.eq("key", "component-cutover"))
        .unique()
    )
      throw new Error(
        "Legacy balance funding starts are fenced by the cutover checkpoint.",
      );
    if (args.enabled && !args.consent)
      throw new Error("Explicit consent is required.");
    const setting = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first();
    if (!setting) throw new Error("Balance preparation is missing.");
    if (setting.migrationPaused)
      throw new Error("Legacy balance funding is paused for migration.");
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
    if (
      setting.componentMigration &&
      setting.componentMigration.state !== "rolled_back"
    )
      throw new Error(
        "Funding migrated; reconcile the original component operation.",
      );
    await ctx.db.patch("storeBalanceFunding", setting._id, {
      enabled: args.enabled,
      operationPending: false,
    });
    return null;
  },
});
