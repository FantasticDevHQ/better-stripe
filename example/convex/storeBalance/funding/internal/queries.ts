import { v } from "convex/values";

import { internalQuery } from "../../../_generated/server";
import { components } from "../../../_generated/api";
import { fundingScope, LEGACY_FUNDING_API_VERSION } from "../migration";
import { doc } from "../helpers";

export const read = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.union(doc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first(),
});

/** Server-only renewal reader. Unverified or pending funding never authorizes collection. */
export const paymentSource = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.union(v.object({ paymentMethodId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    const subscriptionId = seller?.storePlan?.stripeSubscriptionId;
    if (seller?.role !== "seller" || !seller.stripeAccountId || !subscriptionId)
      return null;
    const saved = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.readScopePreparation,
      {
        accountId: seller.stripeAccountId,
        scopeKey: fundingScope(args.sellerId, subscriptionId),
        stripeSubscriptionId: subscriptionId,
        providerApiVersion: LEGACY_FUNDING_API_VERSION,
      },
    );
    if (
      !saved ||
      "status" in saved ||
      !saved.verified ||
      !saved.preparation.paymentMethodId ||
      !saved.enabled ||
      saved.activeOperationId ||
      saved.startsPaused
    )
      return null;
    return { paymentMethodId: saved.preparation.paymentMethodId };
  },
});
