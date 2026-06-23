import { v } from "convex/values";

import { query } from "../_generated/server";
import {
  disputeDocValidator,
  disputeStatusValidator,
  paymentDocValidator,
  payoutDocValidator,
  payoutStatusValidator,
  refundDocValidator,
  refundStatusValidator,
} from "./validators";

// =============================================================================
// PAYMENT QUERIES
// =============================================================================

export const getPaymentByStripeId = query({
  args: { stripePaymentIntentId: v.string() },
  returns: v.union(paymentDocValidator, v.null()),
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
  returns: v.union(payoutDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("payouts", args.payoutId);
  },
});

export const getPayoutByStripeId = query({
  args: { stripePayoutId: v.string() },
  returns: v.union(payoutDocValidator, v.null()),
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
  returns: v.array(payoutDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId !== undefined && args.status !== undefined) {
      const { accountId, status } = args;
      return await ctx.db
        .query("payouts")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", accountId).eq("status", status),
        )
        .take(limit);
    }

    if (args.accountId !== undefined) {
      const accountId = args.accountId;
      return await ctx.db
        .query("payouts")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
    }

    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query("payouts")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }

    return await ctx.db.query("payouts").take(limit);
  },
});

// =============================================================================
// REFUND QUERIES
// =============================================================================

export const getRefundByStripeId = query({
  args: { stripeRefundId: v.string() },
  returns: v.union(refundDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("refunds")
      .withIndex("by_stripe_refund_id", (q) =>
        q.eq("stripeRefundId", args.stripeRefundId),
      )
      .first();
  },
});

/**
 * List refunds. A `status` filter is only honored alongside `accountId` or
 * `stripePaymentIntentId` (the indexed combinations); a lone `status` falls
 * through to an unfiltered scan rather than a filter-after-take (Plan 002).
 */
export const listRefunds = query({
  args: {
    accountId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.optional(refundStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(refundDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId !== undefined && args.status !== undefined) {
      const { accountId, status } = args;
      return await ctx.db
        .query("refunds")
        .withIndex("by_account_id_and_status", (q) =>
          q.eq("accountId", accountId).eq("status", status),
        )
        .take(limit);
    }

    if (args.stripePaymentIntentId !== undefined && args.status !== undefined) {
      const { stripePaymentIntentId, status } = args;
      return await ctx.db
        .query("refunds")
        .withIndex("by_payment_intent_id_and_status", (q) =>
          q
            .eq("stripePaymentIntentId", stripePaymentIntentId)
            .eq("status", status),
        )
        .take(limit);
    }

    if (args.accountId !== undefined) {
      const accountId = args.accountId;
      return await ctx.db
        .query("refunds")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
    }

    if (args.stripePaymentIntentId !== undefined) {
      const stripePaymentIntentId = args.stripePaymentIntentId;
      return await ctx.db
        .query("refunds")
        .withIndex("by_stripe_payment_intent_id", (q) =>
          q.eq("stripePaymentIntentId", stripePaymentIntentId),
        )
        .take(limit);
    }

    return await ctx.db.query("refunds").take(limit);
  },
});

// =============================================================================
// DISPUTE QUERIES
// =============================================================================

export const getDisputeByStripeId = query({
  args: { stripeDisputeId: v.string() },
  returns: v.union(disputeDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("disputes")
      .withIndex("by_stripe_dispute_id", (q) =>
        q.eq("stripeDisputeId", args.stripeDisputeId),
      )
      .first();
  },
});

/**
 * List disputes. Same index-aware filtering rules as {@link listRefunds}.
 */
export const listDisputes = query({
  args: {
    accountId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.optional(disputeStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(disputeDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId !== undefined && args.status !== undefined) {
      const { accountId, status } = args;
      return await ctx.db
        .query("disputes")
        .withIndex("by_account_id_and_status", (q) =>
          q.eq("accountId", accountId).eq("status", status),
        )
        .take(limit);
    }

    if (args.stripePaymentIntentId !== undefined && args.status !== undefined) {
      const { stripePaymentIntentId, status } = args;
      return await ctx.db
        .query("disputes")
        .withIndex("by_payment_intent_id_and_status", (q) =>
          q
            .eq("stripePaymentIntentId", stripePaymentIntentId)
            .eq("status", status),
        )
        .take(limit);
    }

    if (args.accountId !== undefined) {
      const accountId = args.accountId;
      return await ctx.db
        .query("disputes")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
    }

    if (args.stripePaymentIntentId !== undefined) {
      const stripePaymentIntentId = args.stripePaymentIntentId;
      return await ctx.db
        .query("disputes")
        .withIndex("by_stripe_payment_intent_id", (q) =>
          q.eq("stripePaymentIntentId", stripePaymentIntentId),
        )
        .take(limit);
    }

    return await ctx.db.query("disputes").take(limit);
  },
});
