import { v } from "convex/values";

import { query } from "../_generated/server";

import { stripe } from "../stripe/helpers";

export const describePrice = query({
  args: { stripePriceId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      amount: v.number(),
      currency: v.string(),
      type: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const price = await stripe.getPriceByStripeId(ctx, args);
    if (!price?.active || price.unitAmount === undefined) return null;
    const product = await stripe.getProductByStripeId(ctx, {
      stripeProductId: price.stripeProductId,
    });
    return product?.active
      ? {
          name: product.name,
          amount: price.unitAmount,
          currency: price.currency,
          type: price.type,
        }
      : null;
  },
});
