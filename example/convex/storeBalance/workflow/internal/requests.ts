import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import { internal, components } from "../../../_generated/api";
import { fundingScope } from "../../funding/migration";
import { requestDoc, operationReference } from "../validators";
import { STRIPE_CUSTOMER_PREVIEW_API_VERSION } from "@fantastic.dev/better-stripe";

export const queue = internalMutation({
  args: {
    sellerId: v.id("users"),
    accountId: v.string(),
    subscriptionId: v.string(),
    enabled: v.boolean(),
    consent: v.optional(v.literal(true)),
  },
  returns: v.union(v.id("storeBalanceRequests"), v.null()),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (
      seller?.role !== "seller" ||
      seller.stripeAccountId !== args.accountId ||
      seller.storePlan?.stripeSubscriptionId !== args.subscriptionId
    )
      throw new Error("Funding request ownership changed.");
    if (args.enabled && args.consent !== true)
      throw new Error("Explicit consent is required.");
    const previous = await ctx.db
      .query("storeBalanceRequests")
      .withIndex("by_seller_subscription", (q) =>
        q
          .eq("sellerId", args.sellerId)
          .eq("subscriptionId", args.subscriptionId),
      )
      .order("desc")
      .first();
    const scopeKey = fundingScope(args.sellerId, args.subscriptionId);
    if (previous && previous.state !== "finished") {
      if (
        previous.accountId !== args.accountId ||
        previous.scopeKey !== scopeKey ||
        previous.enabled !== args.enabled
      )
        throw new Error(
          "Another funding request is pending; reconcile it first.",
        );
      if (previous.state === "held") {
        await ctx.db.patch("storeBalanceRequests", previous._id, {
          state: "pending",
        });
        await ctx.scheduler.runAfter(
          0,
          internal.storeBalance.workflow.internal.actions.advance,
          { requestId: previous._id, attempt: 0, retryRequested: true },
        );
      }
      return previous._id;
    }
    const saved = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.readScopePreparation,
      {
        accountId: args.accountId,
        scopeKey,
        stripeSubscriptionId: args.subscriptionId,
        providerApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
      },
    );
    if (saved && "status" in saved)
      throw new Error("Funding scope requires reconciliation.");
    if (
      (!saved && !args.enabled) ||
      (saved?.verified &&
        !saved.activeOperationId &&
        saved.enabled === args.enabled)
    )
      return null;
    const requestId = await ctx.db.insert("storeBalanceRequests", {
      sellerId: args.sellerId,
      accountId: args.accountId,
      scopeKey,
      subscriptionId: args.subscriptionId,
      enabled: args.enabled,
      consentAt: Date.now(),
      state: "pending",
    });
    await ctx.scheduler.runAfter(
      0,
      internal.storeBalance.workflow.internal.actions.advance,
      { requestId, attempt: 0, retryRequested: true },
    );
    return requestId;
  },
});
export const read = internalQuery({
  args: { requestId: v.id("storeBalanceRequests") },
  returns: v.union(requestDoc, v.null()),
  handler: (ctx, args) => ctx.db.get("storeBalanceRequests", args.requestId),
});
export const bind = internalMutation({
  args: {
    requestId: v.id("storeBalanceRequests"),
    operation: operationReference,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storeBalanceRequests", args.requestId);
    if (
      !row ||
      row.accountId !== args.operation.accountId ||
      row.scopeKey !== args.operation.scopeKey
    )
      throw new Error("Funding request identity changed.");
    if (row.state === "finished") {
      if (
        !row.operation ||
        row.operation.accountId !== args.operation.accountId ||
        row.operation.scopeKey !== args.operation.scopeKey ||
        row.operation.operationId !== args.operation.operationId ||
        row.operation.version !== args.operation.version ||
        row.operation.kind !== args.operation.kind
      )
        throw new Error("Finished funding request identity changed.");
      return null;
    }
    const { kind, ...reference } = args.operation;
    const op = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.inspectOperation,
      {
        ...reference,
        stripeSubscriptionId: row.subscriptionId,
      },
    );
    if (!op || op.kind !== kind)
      throw new Error("Funding operation identity changed.");
    if (row.operation?.kind === "apply" && args.operation.kind === "prepare")
      return null;
    if (
      row.operation?.kind === args.operation.kind &&
      row.operation.operationId !== args.operation.operationId
    )
      throw new Error("Funding operation reference changed.");
    await ctx.db.patch("storeBalanceRequests", row._id, {
      operation: args.operation,
      state: "pending",
    });
    return null;
  },
});
export const hold = internalMutation({
  args: { requestId: v.id("storeBalanceRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storeBalanceRequests", args.requestId);
    if (row && row.state !== "finished")
      await ctx.db.patch("storeBalanceRequests", row._id, { state: "held" });
    return null;
  },
});
export const complete = internalMutation({
  args: { requestId: v.id("storeBalanceRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storeBalanceRequests", args.requestId);
    if (!row) throw new Error("Funding request is missing.");
    if (row.state === "finished") return null;
    const saved = await ctx.runQuery(
      components.betterStripe.balanceFunding.queries.readScopePreparation,
      {
        accountId: row.accountId,
        scopeKey: row.scopeKey,
        stripeSubscriptionId: row.subscriptionId,
        providerApiVersion: STRIPE_CUSTOMER_PREVIEW_API_VERSION,
      },
    );
    if (
      !saved ||
      "status" in saved ||
      !saved.verified ||
      saved.activeOperationId ||
      saved.enabled !== row.enabled
    )
      throw new Error(
        "Funding has not completed its verified component operation.",
      );
    await ctx.db.patch("storeBalanceRequests", row._id, { state: "finished" });
    return null;
  },
});
