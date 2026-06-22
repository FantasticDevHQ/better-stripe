import { v } from "convex/values";

import { mutation } from "../_generated/server";
import {
  disputeFields,
  paymentStatusValidator,
  payoutStatusValidator,
  refundFields,
} from "./validators";

// =============================================================================
// PAYMENT MUTATIONS
// =============================================================================

export const upsertPayment = mutation({
  args: {
    stripePaymentIntentId: v.string(),
    userId: v.string(),
    orgId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    status: paymentStatusValidator,
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent_id", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("payments", existing._id, args);
    } else {
      await ctx.db.insert("payments", args);
    }

    return null;
  },
});

// =============================================================================
// PAYOUT MUTATIONS
// =============================================================================

export const upsertPayout = mutation({
  args: {
    stripePayoutId: v.string(),
    accountId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: payoutStatusValidator,
    arrivalDate: v.optional(v.string()),
    method: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("payouts")
      .withIndex("by_stripe_payout_id", (q) =>
        q.eq("stripePayoutId", args.stripePayoutId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("payouts", existing._id, args);
    } else {
      await ctx.db.insert("payouts", args);
    }

    return null;
  },
});

// =============================================================================
// REFUND MUTATIONS
// =============================================================================

export const upsertRefund = mutation({
  args: refundFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("refunds")
      .withIndex("by_stripe_refund_id", (q) =>
        q.eq("stripeRefundId", args.stripeRefundId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("refunds", existing._id, args);
    } else {
      await ctx.db.insert("refunds", args);
    }

    // Denormalize cumulative refund state onto the linked `payments` row so
    // consumers can answer "is this payment whole?" in one read. Runs in the
    // same transaction as the refund upsert.
    const paymentIntentId = args.stripePaymentIntentId;
    if (paymentIntentId) {
      const payment = await ctx.db
        .query("payments")
        .withIndex("by_stripe_payment_intent_id", (q) =>
          q.eq("stripePaymentIntentId", paymentIntentId),
        )
        .first();

      if (payment) {
        // Bounded cardinality: a single payment intent can only be refunded
        // down to zero, so the number of refund rows per PI is inherently small.
        // eslint-disable-next-line @convex-dev/no-collect-in-query
        const refunds = await ctx.db
          .query("refunds")
          .withIndex("by_stripe_payment_intent_id", (q) =>
            q.eq("stripePaymentIntentId", paymentIntentId),
          )
          .collect();

        // Money is considered returned for any refund that isn't failed or
        // canceled (matches Stripe's Charge.amount_refunded semantics).
        const refundedAmount = refunds
          .filter((r) => r.status !== "failed" && r.status !== "canceled")
          .reduce((sum, r) => sum + r.amount, 0);

        const refundStatus =
          refundedAmount <= 0
            ? undefined
            : refundedAmount >= payment.amount
              ? ("fully_refunded" as const)
              : ("partially_refunded" as const);

        await ctx.db.patch("payments", payment._id, {
          refundedAmount,
          refundStatus,
        });
      }
    }

    return null;
  },
});

// =============================================================================
// DISPUTE MUTATIONS
// =============================================================================

export const upsertDispute = mutation({
  args: disputeFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("disputes")
      .withIndex("by_stripe_dispute_id", (q) =>
        q.eq("stripeDisputeId", args.stripeDisputeId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("disputes", existing._id, args);
    } else {
      await ctx.db.insert("disputes", args);
    }

    return null;
  },
});
