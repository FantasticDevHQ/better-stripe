import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import {
  affiliateSnapshotValidator,
  affiliateOperationValidator,
} from "@fantastic.dev/better-stripe";
import { query, internalQuery, action, env } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";
import type { Id } from "./_generated/dataModel";
import { assertTestModeStripeKey } from "./authz";
// Demo persona binding only. A client-selected user ID is not authentication.
async function viewer(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (!user || !["affiliate", "admin"].includes(user.role)) return null;
  return user;
}
export const snapshot = query({
  args: {
    userId: v.id("users"),
    currency: v.string(),
    affiliateAccountId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(affiliateSnapshotValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.userId);
    if (!user) return null;
    const account =
      user.role === "admin"
        ? (args.affiliateAccountId ?? user.stripeAccountId)
        : user.stripeAccountId;
    if (
      !account ||
      (args.affiliateAccountId &&
        user.role !== "admin" &&
        args.affiliateAccountId !== account)
    )
      throw new Error("Affiliate recovery is not available for this account.");
    return stripe.affiliateRecovery.snapshot(ctx, {
      affiliateAccountId: account,
      currency: args.currency,
      paginationOpts: args.paginationOpts,
    });
  },
});
export const history = query({
  args: {
    userId: v.id("users"),
    obligationId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(
    paginationResultValidator(affiliateOperationValidator),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.userId);
    if (!user) return null;
    const row = await stripe.affiliateRecovery.obligation(ctx, {
      obligationId: args.obligationId,
    });
    if (
      !row ||
      (user.role !== "admin" && row.affiliateAccountId !== user.stripeAccountId)
    )
      throw new Error("Affiliate recovery is not available for this account.");
    return stripe.affiliateRecovery.history(ctx, {
      obligationId: args.obligationId,
      paginationOpts: args.paginationOpts,
    });
  },
});
export const requireOperator = internalQuery({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.userId);
    if (user?.role !== "admin")
      throw new Error("An operator persona is required.");
    return null;
  },
});
export const retry = action({
  args: { userId: v.id("users"), obligationId: v.string() },
  returns: v.object({
    state: v.string(),
    error: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.affiliateRecovery.requireOperator, {
      userId: args.userId,
    });
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    return stripe.affiliateRecovery.retry(ctx, {
      obligationId: args.obligationId,
    });
  },
});
