import { v } from "convex/values";

import { query } from "../../../_generated/server";

import { storePlanRecordValidator } from "../../validators";

import { hasPaidStorePlan } from "../../helpers";

export const getState = query({
  args: { sellerId: v.id("users") },
  returns: v.object({
    storePlan: v.optional(storePlanRecordValidator),
    hasAccess: v.boolean(),
    stripeAccountId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to manage a store plan.");
    return {
      storePlan: seller.storePlan,
      hasAccess: hasPaidStorePlan(seller.storePlan),
      stripeAccountId: seller.stripeAccountId,
    };
  },
});
