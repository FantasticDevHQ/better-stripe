import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { STORE_PLANS } from "./lib/storePlans";
import { storePlanIdValidator } from "./lib/storePlanValidators";
import { getStripeClient } from "./lib/stripeClient";
const settings = {
  monthlyAmount: v.number(),
  feeBasisPoints: v.union(v.number(), v.null()),
};
const edit = {
  adminId: v.id("users"),
  planId: storePlanIdValidator,
  ...settings,
  expectedVersion: v.number(),
};
const planValidator = v.object({
  id: storePlanIdValidator,
  name: v.string(),
  ...settings,
  feeLabel: v.string(),
  version: v.number(),
});
export function validatePricing(
  monthlyAmount: number,
  feeBasisPoints: number | null,
) {
  if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount <= 0)
    throw new Error("Monthly price must be a positive number of cents.");
  if (
    feeBasisPoints !== null &&
    (!Number.isSafeInteger(feeBasisPoints) ||
      feeBasisPoints < 0 ||
      feeBasisPoints > 10000)
  )
    throw new Error("Sale fee must be between 0 and 100%.");
}
async function plans(ctx: QueryCtx) {
  const saved = await ctx.db.query("storePlanSettings").take(3);
  return STORE_PLANS.map((plan) => {
    const override = saved.find((row) => row.planId === plan.id);
    const feeBasisPoints = override
      ? override.feeBasisPoints
      : plan.feeBasisPoints;
    return {
      id: plan.id,
      name: plan.name,
      monthlyAmount: override?.monthlyAmount ?? plan.monthlyAmount,
      feeBasisPoints,
      version: override?.version ?? 0,
      feeLabel:
        feeBasisPoints === null || feeBasisPoints === 0
          ? "Stripe processing only, no platform transaction fee"
          : `${feeBasisPoints / 100}% per sale or actual Stripe processing, whichever is higher`,
    };
  });
}
export const list = query({
  args: {},
  returns: v.array(planValidator),
  handler: plans,
});
export const read = internalQuery({
  args: {},
  returns: v.array(planValidator),
  handler: plans,
});
export const authorize = internalQuery({
  args: { adminId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.adminId))?.role !== "admin")
      throw new Error("Only an admin can change store plan pricing.");
    return null;
  },
});
export const publish = internalMutation({
  args: { ...edit, stripeProductId: v.string(), stripePriceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.adminId))?.role !== "admin")
      throw new Error("Only an admin can change store plan pricing.");
    validatePricing(args.monthlyAmount, args.feeBasisPoints);
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
export const update = action({
  args: edit,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.storePlanPricing.authorize, {
      adminId: args.adminId,
    });
    validatePricing(args.monthlyAmount, args.feeBasisPoints);
    const configured = await ctx.runQuery(internal.storePlanPricing.read, {});
    const plan = configured.find((row) => row.id === args.planId)!;
    if (plan.version !== args.expectedVersion)
      throw new Error(
        "Pricing changed while you were editing. Reload and try again.",
      );
    const catalog = await ctx.runAction(
      internal.storePlanActions.ensureCatalog,
      {},
    );
    const entry = catalog.find((row) => row.planId === args.planId)!;
    let stripePriceId = entry.stripePriceId;
    if (args.monthlyAmount !== plan.monthlyAmount) {
      const price = await getStripeClient().prices.create(
        {
          product: entry.stripeProductId,
          unit_amount: args.monthlyAmount,
          currency: "usd",
          recurring: { interval: "month" },
          nickname: plan.name,
          metadata: {
            storePlanId: args.planId,
            storePlanVersion: String(plan.version + 1),
          },
        },
        {
          idempotencyKey: `example_store_price_${args.planId}_${plan.version + 1}_${args.monthlyAmount}_${args.feeBasisPoints}`,
        },
      );
      stripePriceId = price.id;
    }
    await ctx.runMutation(internal.storePlanPricing.publish, {
      ...args,
      stripeProductId: entry.stripeProductId,
      stripePriceId,
    });
    return null;
  },
});
