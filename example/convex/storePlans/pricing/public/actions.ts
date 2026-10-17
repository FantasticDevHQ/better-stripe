import { v } from "convex/values";

import { action } from "../../../_generated/server";

import { internal } from "../../../_generated/api";

import {
  validateFixedAffiliateAmount,
  storePlanLookupKey,
} from "../../helpers";

import { stripe } from "../../../stripe/helpers";
import { edit, validatePricing } from "../helpers";

export const update = action({
  args: edit,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.storePlans.pricing.internal.queries.authorize, {
      adminId: args.adminId,
    });
    validateFixedAffiliateAmount(args.affiliateFixedAmount);
    validatePricing(
      args.monthlyAmount,
      args.feeBasisPoints,
      args.affiliateBasisPoints,
    );
    const configured = await ctx.runQuery(
      internal.storePlans.pricing.internal.queries.read,
      {},
    );
    const plan = configured.find((row) => row.id === args.planId)!;
    if (plan.version !== args.expectedVersion)
      throw new Error(
        "Pricing changed while you were editing. Reload and try again.",
      );
    const catalog = await ctx.runAction(
      internal.storePlans.internal.actions.ensureCatalog,
      {},
    );
    const entry = catalog.find((row) => row.planId === args.planId)!;
    let stripePriceId = entry.stripePriceId;
    if (args.monthlyAmount !== plan.monthlyAmount) {
      const price = await stripe.ensurePrice(ctx, {
        stripeProductId: entry.stripeProductId,
        unitAmount: args.monthlyAmount,
        currency: "usd",
        type: "recurring",
        interval: "month",
        nickname: plan.name,
        metadata: {
          storePlanId: args.planId,
          storePlanVersion: String(plan.version + 1),
        },
        lookupKey: `${storePlanLookupKey(args.planId)}_${plan.version + 1}_${args.monthlyAmount}`,
        idempotencyKey: `example_store_price_${args.planId}_${plan.version + 1}_${args.monthlyAmount}_${args.feeBasisPoints}`,
      });
      stripePriceId = price.stripePriceId;
    }
    await ctx.runMutation(
      internal.storePlans.pricing.internal.mutations.publish,
      {
        ...args,
        stripeProductId: entry.stripeProductId,
        stripePriceId,
      },
    );
    return null;
  },
});
