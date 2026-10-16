import { v } from "convex/values";

import { action, env } from "../../_generated/server";

import { internal } from "../../_generated/api";

import { stripe } from "../../stripe/helpers";

import { assertTestModeStripeKey } from "../../users/authorization";

export const retry = action({
  args: { userId: v.id("users"), obligationId: v.string() },
  returns: v.object({
    state: v.string(),
    error: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(
      internal.affiliateRecovery.internal.queries.requireOperator,
      {
        userId: args.userId,
      },
    );
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    return stripe.affiliateRecovery.retry(ctx, {
      obligationId: args.obligationId,
    });
  },
});
