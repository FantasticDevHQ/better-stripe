import { v } from "convex/values";

import { internalQuery } from "../../../_generated/server";

import { storePlanIdValidator } from "../../validators";

import { sellerValidator } from "../helpers";

export const getSeller = internalQuery({
  args: { sellerId: v.id("users") },
  returns: sellerValidator,
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to manage a store plan.");
    return {
      sellerId: seller._id,
      name: seller.storeName ?? seller.name,
      email: seller.email,
      stripeAccountId: seller.stripeAccountId,
      storePlan: seller.storePlan,
    };
  },
});

export const readCatalog = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      planId: storePlanIdValidator,
      stripeProductId: v.string(),
      stripePriceId: v.string(),
    }),
  ),
  handler: async (ctx) =>
    (await ctx.db.query("storePlanCatalog").take(3)).map(
      ({ planId, stripeProductId, stripePriceId }) => ({
        planId,
        stripeProductId,
        stripePriceId,
      }),
    ),
});
