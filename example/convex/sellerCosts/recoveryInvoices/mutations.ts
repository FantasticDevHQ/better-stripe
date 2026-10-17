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
    const prepared = await stripe.costRecovery.prepareGroup(ctx, {
      ...scope,
      groupKey,
      sourceKind: "invoice",
      sourceId: args.invoiceId,
      maxDebit: Number.MAX_SAFE_INTEGER,
      maxCredit: Number.MAX_SAFE_INTEGER,
    });
    if (prepared.status === "conflict" && prepared.reason === "scope_busy")
      return null;
    if (prepared.status !== "prepared")
      throw new Error(
        `Recovery invoice preparation failed: ${prepared.reason}.`,
      );
    return prepared.isDone;
  },
});
