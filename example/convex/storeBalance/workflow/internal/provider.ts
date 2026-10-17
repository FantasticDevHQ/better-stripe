import { v } from "convex/values";
import type { FundingProviderPhaseResult } from "@fantastic.dev/better-stripe";
import { internalAction, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { phaseFields, providerResult } from "../validators";
import { fundingScope } from "../../funding/migration";
import { balanceStripe } from "../../stripe";
import { ownedBillingSubscription } from "../../ownership";
export const owner = internalQuery({
  args: {
    accountId: v.string(),
    scopeKey: v.string(),
    stripeSubscriptionId: v.string(),
  },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_stripe_account", (q) =>
        q.eq("stripeAccountId", args.accountId),
      )
      .take(2);
    const seller = rows.length === 1 ? rows[0] : undefined;
    return seller?.role === "seller" &&
      seller.storePlan?.stripeSubscriptionId === args.stripeSubscriptionId &&
      fundingScope(seller._id, args.stripeSubscriptionId) === args.scopeKey
      ? seller._id
      : null;
  },
});
export const execute = internalAction({
  args: phaseFields,
  returns: providerResult,
  handler: async (ctx, args): Promise<FundingProviderPhaseResult> => {
    const sellerId = await ctx.runQuery(
      internal.storeBalance.workflow.internal.provider.owner,
      {
        accountId: args.accountId,
        scopeKey: args.scopeKey,
        stripeSubscriptionId: args.stripeSubscriptionId,
      },
    );
    if (!sellerId)
      return {
        status: "conflict",
        reason: "identity_changed",
        retryable: false,
      };
    await ownedBillingSubscription(ctx, sellerId);
    return balanceStripe.balanceFundingWorkflow.executeProviderPhase(ctx, args);
  },
});
