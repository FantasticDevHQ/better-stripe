import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

import { costScope } from "../recovery";

export const prepare = internalMutation({
  args: {
    sellerId: v.id("users"),
    invoiceId: v.string(),
    currency: v.string(),
  },
  returns: v.union(v.boolean(), v.null()),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller" || !seller.stripeAccountId)
      throw new Error("Seller account is unavailable.");
    if (
      await ctx.db
        .query("sellerCosts")
        .withIndex("by_recovery_version", (q) =>
          q.eq("sellerId", seller._id).eq("recoveryVersion", undefined),
        )
        .first()
    )
      throw new Error("Migrate legacy recovery before preparing an invoice.");
    const scope = costScope(seller._id, seller.stripeAccountId, args.currency),
      groupKey = `example:cost-invoice:${args.invoiceId}`;
    const existing = await stripe.costRecovery.getGroup(ctx, { groupKey });
    if (
      existing &&
      (existing.accountId !== scope.accountId ||
        existing.scopeKey !== scope.scopeKey ||
        existing.currency !== scope.currency)
    )
      throw new Error("Recovery invoice scope changed.");
    if (existing && existing.status !== "open") return true;
    const current = await stripe.costRecovery.balance(ctx, scope);
    if (current.activeGroupKey && current.activeGroupKey !== groupKey)
      return null;
    await stripe.costRecovery.reserve(ctx, {
      ...scope,
      groupKey,
      operationKey: `${groupKey}:batch:${existing?.pendingOperations ?? 0}`,
      sourceKind: "invoice",
      sourceId: args.invoiceId,
      maxDebit: Number.MAX_SAFE_INTEGER,
      maxCredit: Number.MAX_SAFE_INTEGER,
    });
    const ledger = await stripe.costRecovery.balance(ctx, scope);
    if (ledger.outstanding !== 0) return false;
    await stripe.costRecovery.seal(ctx, { groupKey });
    return true;
  },
});
