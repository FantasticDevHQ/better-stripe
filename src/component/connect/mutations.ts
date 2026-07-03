import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { feeRoutingFields } from "../lib/fees";
import { computeReversalSlices } from "../lib/reversals";
import {
  disputeFields,
  paymentStatusValidator,
  payoutStatusValidator,
  refundFields,
  transferFields,
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
    ...feeRoutingFields,
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
      // A redelivered payment_intent.succeeded carries the GROSS fee. If a
      // fee refund was already recorded (recordPaymentFeeRefund keeps
      // `collected = fee − refunded`), re-derive the net amount instead of
      // blanket-patching the refunded fee back up (BTS-63, path 3).
      const priorFeeRefunded = existing.feeRefundedAmount ?? 0;
      const patch =
        priorFeeRefunded > 0 && args.feeCollectedAmount !== undefined
          ? {
              ...args,
              feeCollectedAmount: Math.max(
                0,
                args.feeCollectedAmount - priorFeeRefunded,
              ),
            }
          : args;
      await ctx.db.patch("payments", existing._id, patch);
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

/**
 * Record fee-refund state on the linked payment (BTS-34). Values are ABSOLUTE
 * cumulative totals from Stripe's `application_fee.refunded` event (never
 * incremented here), so redeliveries and createRefund-triggered duplicates
 * can't double-count. No-op when the payment row doesn't exist.
 */
export const recordPaymentFeeRefund = mutation({
  args: {
    stripePaymentIntentId: v.string(),
    /** Net fee kept by the platform: fee amount − amount refunded. */
    feeCollectedAmount: v.number(),
    /** Cumulative fee refunded so far. */
    feeRefundedAmount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent_id", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .first();
    if (payment) {
      // `feeRefundedAmount` is a cumulative total. Keep it monotonic (mirroring
      // `recordTransferReversal`) so an out-of-order/stale redelivery can't
      // regress the refunded total or inflate the collected fee back up. The two
      // fields move together (collected = fee − refunded), so the event with the
      // larger refunded total wins both — apply nothing when the incoming event
      // is stale.
      if (args.feeRefundedAmount >= (payment.feeRefundedAmount ?? 0)) {
        await ctx.db.patch("payments", payment._id, {
          feeCollectedAmount: args.feeCollectedAmount,
          feeRefundedAmount: args.feeRefundedAmount,
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

// =============================================================================
// TRANSFER MUTATIONS (ledger — BTS-12)
// =============================================================================

/**
 * Derive reversal status + transfer status from a (transfer amount, cumulative
 * reversed amount) pair. Shared by upsert and reversal so the three reversal
 * fields can never drift.
 */
function deriveReversalState(
  amount: number,
  reversedAmount: number,
  baseStatus: "pending" | "paid" | "failed" | "reversed",
) {
  const reversalStatus =
    reversedAmount <= 0
      ? undefined
      : reversedAmount >= amount
        ? ("fully_reversed" as const)
        : ("partially_reversed" as const);
  return {
    reversedAmount: reversedAmount > 0 ? reversedAmount : undefined,
    reversalStatus,
    status: reversalStatus === "fully_reversed" ? ("reversed" as const) : baseStatus,
  };
}

export const upsertTransfer = mutation({
  args: transferFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", args.stripeTransferId),
      )
      .first();

    if (existing) {
      // Reversal state is monotonic: a re-delivered/stale base payload must not
      // shrink reversedAmount or flip a fully-reversed row back to paid.
      const reversedAmount = Math.max(
        existing.reversedAmount ?? 0,
        args.reversedAmount ?? 0,
      );
      const derived = deriveReversalState(args.amount, reversedAmount, args.status);
      await ctx.db.patch("transfers", existing._id, { ...args, ...derived });
    } else {
      const derived = deriveReversalState(
        args.amount,
        args.reversedAmount ?? 0,
        args.status,
      );
      await ctx.db.insert("transfers", { ...args, ...derived });
    }

    return null;
  },
});

/**
 * Record a (possibly partial) reversal against a transfer, denormalizing the
 * cumulative `reversedAmount` and a derived `reversalStatus`. `reversedAmount`
 * is the new cumulative total (matches Stripe's `Transfer.amount_reversed`).
 */
export const recordTransferReversal = mutation({
  args: {
    stripeTransferId: v.string(),
    reversedAmount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const transfer = await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", args.stripeTransferId),
      )
      .first();

    if (!transfer) {
      throw new Error(
        `Cannot record reversal: no transfer found for ${args.stripeTransferId}`,
      );
    }

    // `reversedAmount` is a cumulative total (matches Stripe's
    // `Transfer.amount_reversed`). Keep it monotonic so a stale/out-of-order
    // event can't shrink it or undo a full reversal.
    const reversedAmount = Math.max(
      transfer.reversedAmount ?? 0,
      args.reversedAmount,
    );
    const derived = deriveReversalState(
      transfer.amount,
      reversedAmount,
      transfer.status,
    );

    await ctx.db.patch("transfers", transfer._id, derived);

    return null;
  },
});

/** How `claimReversalSlices` sizes each leg's slice. */
const reversalModeValidator = v.union(
  v.object({ kind: v.literal("full") }),
  v.object({ kind: v.literal("percent"), percent: v.number() }),
  v.object({ kind: v.literal("amount"), amount: v.number() }),
  v.object({
    kind: v.literal("fraction"),
    chargeAmount: v.number(),
    amountRefunded: v.number(),
  }),
);

/**
 * Atomically claim reversal slices for one operation (a dispute or refund
 * clawback) BEFORE any money moves (BTS-63). Runs in a single transaction, so
 * concurrent operations serialize here instead of racing between the ledger
 * read and the Stripe call:
 *
 *  - First claim for an `operationId`: computes slices against each leg's
 *    claim frontier (`max(reversedAmount, reversalClaimedAmount)`), advances
 *    the frontier, and records the slices — atomically. A concurrent distinct
 *    operation claiming the same target gets an EMPTY claim, not a duplicate.
 *  - Any later call with the same `operationId` (webhook redelivery, retry
 *    after a partial failure) replays the recorded slices verbatim, so the
 *    caller re-sends byte-identical Stripe params under the same idempotency
 *    keys no matter how the ledger moved in between.
 *
 * Each returned slice carries the leg's current CONFIRMED `reversedAmount` so
 * the executor can skip slices whose money already moved and was recorded.
 */
export const claimReversalSlices = mutation({
  args: {
    operationId: v.string(),
    sourceChargeId: v.string(),
    mode: reversalModeValidator,
  },
  returns: v.object({
    replay: v.boolean(),
    slices: v.array(
      v.object({
        stripeTransferId: v.string(),
        from: v.number(),
        to: v.number(),
        confirmed: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const confirmedFor = async (stripeTransferId: string) => {
      const row = await ctx.db
        .query("transfers")
        .withIndex("by_stripe_transfer_id", (q) =>
          q.eq("stripeTransferId", stripeTransferId),
        )
        .first();
      return row?.reversedAmount ?? 0;
    };

    const existingOp = await ctx.db
      .query("transferReversalOps")
      .withIndex("by_operation_id", (q) =>
        q.eq("operationId", args.operationId),
      )
      .first();
    if (existingOp) {
      const slices = [];
      for (const s of existingOp.slices) {
        slices.push({ ...s, confirmed: await confirmedFor(s.stripeTransferId) });
      }
      return { replay: true, slices };
    }

    // Original split legs only — reinstatement payouts are audit rows and
    // must never be re-reversed (mirrors listTransfersByCharge).
    const rows = (
      await ctx.db
        .query("transfers")
        .withIndex("by_source_charge_id", (q) =>
          q.eq("sourceChargeId", args.sourceChargeId),
        )
        .take(50)
    ).filter((t) => !t.reinstatement);

    const byId = new Map(rows.map((r) => [r.stripeTransferId, r]));
    const slices = computeReversalSlices(
      rows.map((t) => ({
        stripeTransferId: t.stripeTransferId,
        amount: t.amount,
        frontier: Math.max(t.reversedAmount ?? 0, t.reversalClaimedAmount ?? 0),
      })),
      args.mode,
    );

    for (const s of slices) {
      await ctx.db.patch("transfers", byId.get(s.stripeTransferId)!._id, {
        reversalClaimedAmount: s.to,
      });
    }
    // Record the operation even when it claims nothing, so a redelivery is a
    // deterministic no-op instead of a recomputation against newer state.
    await ctx.db.insert("transferReversalOps", {
      operationId: args.operationId,
      sourceChargeId: args.sourceChargeId,
      slices,
    });

    return {
      replay: false,
      slices: slices.map((s) => ({
        ...s,
        confirmed: byId.get(s.stripeTransferId)!.reversedAmount ?? 0,
      })),
    };
  },
});
