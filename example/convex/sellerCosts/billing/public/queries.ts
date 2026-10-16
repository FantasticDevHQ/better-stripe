import { costClaimKey } from "../../recovery";

import { stripe } from "../../../stripe/helpers";

import { v } from "convex/values";

import { query } from "../../../_generated/server";

import { sellerCostDoc } from "../../validators";

export const list = query({
  args: { sellerId: v.id("users") },
  returns: v.array(sellerCostDoc),
  handler: async (ctx, args) => {
    if ((await ctx.db.get("users", args.sellerId))?.role !== "seller")
      throw new Error("Choose a seller to view costs.");
    const seller = await ctx.db.get("users", args.sellerId);
    const rows = await ctx.db
      .query("sellerCosts")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .order("desc")
      .take(100);
    return Promise.all(
      rows.map(async (row) => {
        if (row.recoveryVersion !== 1) return row;
        const claim = await stripe.costRecovery.getClaim(ctx, {
          claimKey: costClaimKey(row.paymentIntentId),
        });
        if (!claim || claim.accountId !== seller?.stripeAccountId)
          throw new Error("Recovery claim ownership is unavailable.");
        const rollback = await stripe.costRecovery.getClaim(ctx, {
          claimKey: `rollback:${row.invoiceRecoveryGroupKey ?? `example:cost-settlement:${row.sourceChargeId}`}`,
        });
        const amountDue = claim.amountDue + (rollback?.amountDue ?? 0),
          collectedAmount =
            claim.collectedAmount + (rollback?.collectedAmount ?? 0),
          reservedAmount =
            claim.reservedAmount + (rollback?.reservedAmount ?? 0),
          outstanding = claim.outstanding + (rollback?.outstanding ?? 0);
        return {
          ...row,
          amountDue,
          collectedAmount,
          invoicedAmount: reservedAmount,
          reservedAmount,
          outstanding,
          open: outstanding !== 0,
        };
      }),
    );
  },
});
