import { v } from "convex/values";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION } from "@fantastic.dev/better-stripe";
import { query } from "../../../_generated/server";
import { components } from "../../../_generated/api";
import { fundingScope } from "../migration";
export const state = query({
  args: { sellerId: v.id("users") },
  returns: v.object({
    enabled: v.boolean(),
    consentAt: v.optional(v.number()),
    status: v.union(v.literal("idle"), v.literal("pending"), v.literal("held")),
  }),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to manage payment sources.");
    const rows = await ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .take(2);
    if (rows.length > 1)
      throw new Error("Ambiguous legacy balance funding rows.");
    const legacy = rows[0];
    const subscriptionId = seller.storePlan?.stripeSubscriptionId;
    if (!seller.stripeAccountId || !subscriptionId)
      return {
        enabled: false,
        status: legacy ? ("held" as const) : ("idle" as const),
      };
    if (
      legacy &&
      (legacy.subscriptionId !== subscriptionId ||
        (legacy.componentMigration &&
          legacy.componentMigration.accountId !== seller.stripeAccountId))
    )
      return { enabled: false, status: "held" as const };
    if (legacy && legacy.componentMigration?.state !== "active")
      return {
        enabled: legacy.enabled,
        consentAt: legacy.consentAt,
        status: legacy.migrationPaused ? ("held" as const) : ("idle" as const),
      };
    const saved = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.readScopePreparation,
      {
        accountId: seller.stripeAccountId,
        scopeKey: fundingScope(seller._id, subscriptionId),
        stripeSubscriptionId: subscriptionId,
        providerApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
      },
    );
    const request = await ctx.db
      .query("storeBalanceRequests")
      .withIndex("by_seller_subscription", (q) =>
        q.eq("sellerId", seller._id).eq("subscriptionId", subscriptionId),
      )
      .order("desc")
      .first();
    if (saved && "status" in saved)
      return { enabled: false, status: "held" as const };
    let status: "idle" | "pending" | "held" =
      request?.state === "held"
        ? "held"
        : request?.state === "pending"
          ? "pending"
          : "idle";
    if (saved?.startsPaused || (saved && !saved.verified)) status = "held";
    if (saved?.activeOperationId) {
      const op = await ctx.runQuery(
        components.betterStripe.balanceFunding.queries.getOperation,
        {
          accountId: saved.accountId,
          scopeKey: saved.scopeKey,
          operationId: saved.activeOperationId,
          version: saved.operationVersion,
          stripeSubscriptionId: subscriptionId,
        },
      );
      status =
        op?.state === "unknown" ||
        op?.state === "failed" ||
        op?.state === "canceled" ||
        !op
          ? "held"
          : "pending";
    }
    return {
      enabled: saved?.verified ? saved.enabled : false,
      consentAt: saved?.consentAt ?? request?.consentAt,
      status,
    };
  },
});
