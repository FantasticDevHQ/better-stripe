import { v } from "convex/values";

import { query } from "../_generated/server";
import { payoutStatusValidator } from "./validators";

// =============================================================================
// PAYMENT QUERIES
// =============================================================================

export const getPaymentByStripeId = query({
  args: { stripePaymentIntentId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent_id", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .first();
  },
});

// =============================================================================
// PAYOUT QUERIES
// =============================================================================

export const getPayout = query({
  args: { payoutId: v.id("payouts") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get("payouts", args.payoutId);
  },
});

export const getPayoutByStripeId = query({
  args: { stripePayoutId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payouts")
      .withIndex("by_stripe_payout_id", (q) =>
        q.eq("stripePayoutId", args.stripePayoutId),
      )
      .first();
  },
});

export const listPayouts = query({
  args: {
    accountId: v.optional(v.string()),
    status: v.optional(payoutStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId) {
      const accountId = args.accountId;
      const payouts = await ctx.db
        .query("payouts")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
      if (args.status) return payouts.filter((p) => p.status === args.status);
      return payouts;
    }

    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("payouts")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }

    return await ctx.db.query("payouts").take(limit);
  },
});
