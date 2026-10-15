import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import {
  affiliateSnapshotValidator,
  affiliateOperationValidator,
} from "@fantastic.dev/better-stripe";
import { query, internalQuery, action } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripe } from "./stripe";
async function viewer(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_token", (q) =>
      q.eq("authTokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user || !["affiliate", "admin"].includes(user.role)) return null;
  return user;
}
export const snapshot = query({
  args: {
    currency: v.string(),
    affiliateAccountId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(affiliateSnapshotValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
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
  args: { obligationId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.union(
    paginationResultValidator(affiliateOperationValidator),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    if (!user) return null;
    const row = await stripe.affiliateRecovery.obligation(ctx, {
      obligationId: args.obligationId,
    });
    if (
      !row ||
      (user.role !== "admin" && row.affiliateAccountId !== user.stripeAccountId)
    )
      throw new Error("Affiliate recovery is not available for this account.");
    return stripe.affiliateRecovery.history(ctx, args);
  },
});
export const requireOperator = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await viewer(ctx);
    if (user?.role !== "admin")
      throw new Error("An authenticated operator is required.");
    return null;
  },
});
export const retry = action({
  args: { obligationId: v.string() },
  returns: v.object({
    state: v.string(),
    error: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.affiliateRecovery.requireOperator, {});
    return stripe.affiliateRecovery.retry(ctx, args);
  },
});
