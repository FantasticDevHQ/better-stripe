import { v } from "convex/values";

import { query } from "../_generated/server";
import { accountDocValidator, onboardingStatusValidator } from "./validators";

// =============================================================================
// ACCOUNT QUERIES
// =============================================================================

export const getAccount = query({
  args: { accountId: v.id("accounts") },
  returns: v.union(accountDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("accounts", args.accountId);
  },
});

export const getAccountByStripeId = query({
  args: { stripeAccountId: v.string() },
  returns: v.union(accountDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .first();
  },
});

export const getAccountByUserId = query({
  args: { userId: v.string() },
  returns: v.union(accountDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const getAccountByOrgId = query({
  args: { orgId: v.string() },
  returns: v.union(accountDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
      .first();
  },
});

export const getAccountOnboardingStatus = query({
  args: { accountId: v.id("accounts") },
  returns: v.union(
    v.object({
      onboardingStatus: onboardingStatusValidator,
      isReady: v.boolean(),
      missingRequirements: v.array(v.string()),
      capabilities: v.any(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account) return null;

    return {
      onboardingStatus: account.onboardingStatus,
      isReady: account.onboardingStatus === "complete",
      missingRequirements: account.missingRequirements ?? [],
      capabilities: account.capabilities ?? {},
    };
  },
});

// =============================================================================
// CONFIG QUERIES
// =============================================================================

/**
 * Return the Stripe publishable key from the Convex environment.
 * This is a public, non-auth-gated query so the frontend can load it.
 */
export const getPublishableKey = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => {
    return process.env.STRIPE_PUBLISHABLE_KEY ?? null;
  },
});

export const getStripeMode = query({
  args: {},
  returns: v.union(v.literal("test"), v.literal("live")),
  handler: async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    return secretKey?.startsWith("sk_test_") ? "test" : "live";
  },
});
