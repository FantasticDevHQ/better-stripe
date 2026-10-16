/** Real Stripe sandbox renewal scenarios. Invoked by scripts/test-balance-renewals.ts. */
import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

export const actor = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.object({
    sellerId: v.id("users"),
    email: v.string(),
    stripeAccountId: v.optional(v.string()),
    storePlan: v.optional(
      v.object({
        planId: v.union(
          v.literal("starter"),
          v.literal("growth"),
          v.literal("pro"),
        ),
        stripeSubscriptionId: v.string(),
        status: v.string(),
        paidThrough: v.number(),
        cancelAtPeriodEnd: v.boolean(),
        lastInvoiceId: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (!seller?.testFixture || seller.role !== "seller")
      throw new Error(
        "This operation requires an isolated renewal test seller.",
      );
    return {
      sellerId: seller._id,
      email: seller.email,
      stripeAccountId: seller.stripeAccountId,
      storePlan: seller.storePlan,
    };
  },
});
