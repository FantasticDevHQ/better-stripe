import { v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import {
  disputeDocValidator,
  disputeStatusValidator,
  paymentDocValidator,
  payoutDocValidator,
  payoutStatusValidator,
  refundDocValidator,
  refundStatusValidator,
  transferDocValidator,
  transferReversalOpDocValidator,
  wedgedReversalClaimValidator,
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

/**
 * List payout rows.
 *
 * ⚠️ CAPPED: returns at most `limit ?? 50` rows — a drill-down/list view, NOT a
 * basis for financial totals. Summing the returned rows understates a busy
 * account's paid-out total (BTS-64). For an exact `paidOut` total use
 * {@link getAccountPayouts}, which sums the whole payout ledger server-side.
 */
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
 * List refunds. Every filter is index-backed (Plan 002 — never filter-after-take):
 * `accountId`+`status`, `stripePaymentIntentId`+`status`, `accountId`,
 * `stripePaymentIntentId`, or a lone `status`.
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

    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query("refunds")
        .withIndex("by_status", (q) => q.eq("status", status))
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

    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query("disputes")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }

    return await ctx.db.query("disputes").take(limit);
  },
});

// =============================================================================
// TRANSFER QUERIES (ledger — BTS-12)
// =============================================================================

export const getTransferByStripeId = query({
  args: { stripeTransferId: v.string() },
  returns: v.union(transferDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transfers")
      .withIndex("by_stripe_transfer_id", (q) =>
        q.eq("stripeTransferId", args.stripeTransferId),
      )
      .first();
  },
});

/**
 * All transfers funded from one charge (the legs of a split).
 *
 * Returns every original split leg unless an explicit limit is provided.
 * Reinstatement audit rows do not consume that limit. Database read/response
 * limits fail the query rather than silently returning incomplete money data.
 */
export const listTransfersByCharge = query({
  args: { sourceChargeId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(transferDocValidator),
  handler: async (ctx, args) => {
    if (
      args.limit !== undefined &&
      (!Number.isInteger(args.limit) || args.limit < 0)
    ) {
      throw new Error("limit must be a non-negative integer");
    }
    const rows: Doc<"transfers">[] = [];
    if (args.limit === 0) return rows;
    for await (const transfer of ctx.db
      .query("transfers")
      .withIndex("by_source_charge_id", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )) {
      if (transfer.reinstatement) continue;
      rows.push(transfer);
      if (args.limit !== undefined && rows.length >= args.limit) break;
    }
    return rows;
  },
});

/**
 * All transfers received by one connected account.
 *
 * ⚠️ CAPPED: returns at most `limit ?? 50` rows — a drill-down/list view, NOT a
 * basis for financial totals. Summing the returned rows understates a busy
 * account's earnings (BTS-64). For exact gross/reversed totals use
 * {@link getAccountEarnings}, which sums the whole ledger server-side.
 */
export const listTransfersByAccount = query({
  args: { destinationAccountId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(transferDocValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transfers")
      .withIndex("by_destination_account_id", (q) =>
        q.eq("destinationAccountId", args.destinationAccountId),
      )
      .take(args.limit ?? 50);
  },
});

/** Newest transfers for a recipient, with bounded cursor pagination. */
export const paginateTransfersByAccount = query({
  args: {
    destinationAccountId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(transferDocValidator),
  handler: (ctx, args) =>
    paginator(ctx.db, schema)
      .query("transfers")
      .withIndex("by_destination_account_id", (q) =>
        q.eq("destinationAccountId", args.destinationAccountId),
      )
      .order("desc")
      .paginate(args.paginationOpts),
});

// =============================================================================
// REVERSAL-CLAIM RECLAIM (BTS-74) — ops diagnostics for wedged legs
// =============================================================================

/**
 * Fetch one reversal operation's claim record (BTS-63/74) by its id, or null.
 * The `_creationTime` lets the reclaim path age-gate a release against Stripe's
 * ~24h idempotency-key window.
 */
export const getReversalOp = query({
  args: { operationId: v.string() },
  returns: v.union(transferReversalOpDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transferReversalOps")
      .withIndex("by_operation_id", (q) =>
        q.eq("operationId", args.operationId),
      )
      .first();
  },
});

/**
 * List "wedged" legs (BTS-74): transfers whose reversal claim frontier
 * (`reversalClaimedAmount`) sits ahead of the confirmed `reversedAmount`,
 * because the operation that claimed the gap died permanently and blocks every
 * successor. For each wedged leg, returns the recorded ops holding an
 * unexecuted slice on it (the blockers ops must reclaim).
 *
 * An admin/ops diagnostic, not a hot path. It iterates the `transfers` and
 * `transferReversalOps` tables to completion, so it is exact up to Convex's
 * per-query document-read limit (16,384) — beyond which it throws (loud) rather
 * than silently truncating, matching the BTS-64 aggregate convention.
 */
export const listWedgedReversalClaims = query({
  args: {},
  returns: v.array(wedgedReversalClaimValidator),
  handler: async (ctx) => {
    // Collect the wedged legs first.
    const wedged: Doc<"transfers">[] = [];
    for await (const tr of ctx.db.query("transfers")) {
      if ((tr.reversalClaimedAmount ?? 0) > (tr.reversedAmount ?? 0)) {
        wedged.push(tr);
      }
    }
    if (wedged.length === 0) return [];

    const wedgedIds = new Set(wedged.map((t) => t.stripeTransferId));

    // Index the ops that hold an unexecuted slice on a wedged leg. A slice is
    // unexecuted when its `to` exceeds the leg's confirmed `reversedAmount`.
    const confirmedById = new Map(
      wedged.map((t) => [t.stripeTransferId, t.reversedAmount ?? 0]),
    );
    const blockersByLeg = new Map<
      string,
      { operationId: string; from: number; to: number }[]
    >();
    for await (const op of ctx.db.query("transferReversalOps")) {
      for (const s of op.slices) {
        if (!wedgedIds.has(s.stripeTransferId)) continue;
        if (s.to <= (confirmedById.get(s.stripeTransferId) ?? 0)) continue;
        const list = blockersByLeg.get(s.stripeTransferId) ?? [];
        list.push({ operationId: op.operationId, from: s.from, to: s.to });
        blockersByLeg.set(s.stripeTransferId, list);
      }
    }

    return wedged.map((t) => ({
      stripeTransferId: t.stripeTransferId,
      sourceChargeId: t.sourceChargeId,
      amount: t.amount,
      reversedAmount: t.reversedAmount ?? 0,
      reversalClaimedAmount: t.reversalClaimedAmount ?? 0,
      blockingOps: (blockersByLeg.get(t.stripeTransferId) ?? []).sort(
        (a, b) => a.from - b.from,
      ),
    }));
  },
});

// =============================================================================
// EARNINGS AGGREGATES (BTS-64)
// =============================================================================
//
// The row-list queries above `.take(50)`, so summing their rows client-side
// (as the earnings hooks did) silently understated totals for accounts with
// more than 50 transfers/payouts. These aggregates iterate the account's
// ledger to completion and return EXACT totals regardless of row count, plus a
// bounded preview of rows for drill-down UIs. Exact up to Convex's per-query
// document/byte read limits (currently 32,000 documents or 16 MiB; see
// https://docs.convex.dev/production/state/limits);
// beyond that the query throws (loud) rather than silently truncating —
// strictly safer than a fixed cap for financial figures.

/**
 * Exact earnings totals for one connected account (BTS-64): `gross` (sum of all
 * transfer amounts, incl. reinstatements — the earnings view) and `reversed`
 * (sum of all `reversedAmount`), iterated to completion so totals are never
 * capped. `transfers` is a newest-first bounded preview (`previewLimit ?? 50` rows) for
 * drill-down; use `gross`/`reversed`/`transferCount` for the money figures.
 */
export const getAccountEarnings = query({
  args: {
    destinationAccountId: v.string(),
    previewLimit: v.optional(v.number()),
  },
  returns: v.object({
    gross: v.number(),
    reversed: v.number(),
    transferCount: v.number(),
    transfers: v.array(transferDocValidator),
  }),
  handler: async (ctx, args) => {
    const previewLimit = args.previewLimit ?? 50;
    let gross = 0;
    let reversed = 0;
    let transferCount = 0;
    const transfers: Doc<"transfers">[] = [];

    for await (const tr of ctx.db
      .query("transfers")
      .withIndex("by_destination_account_id", (q) =>
        q.eq("destinationAccountId", args.destinationAccountId),
      )
      .order("desc")) {
      gross += tr.amount;
      reversed += tr.reversedAmount ?? 0;
      transferCount += 1;
      if (transfers.length < previewLimit) transfers.push(tr);
    }

    return { gross, reversed, transferCount, transfers };
  },
});

/**
 * Exact payout totals for one connected account (BTS-64): `paidOut` (sum of all
 * `paid` payout amounts), iterated to completion so it is never capped.
 * `payouts` is a bounded preview (`previewLimit ?? 50` rows) for drill-down; use
 * `paidOut`/`payoutCount` for the money figures.
 */
export const getAccountPayouts = query({
  args: { accountId: v.string(), previewLimit: v.optional(v.number()) },
  returns: v.object({
    paidOut: v.number(),
    payoutCount: v.number(),
    payouts: v.array(payoutDocValidator),
  }),
  handler: async (ctx, args) => {
    const previewLimit = args.previewLimit ?? 50;
    let paidOut = 0;
    let payoutCount = 0;
    const payouts: Doc<"payouts">[] = [];

    for await (const p of ctx.db
      .query("payouts")
      .withIndex("by_account_id", (q) => q.eq("accountId", args.accountId))) {
      payoutCount += 1;
      if (p.status === "paid") paidOut += p.amount;
      if (payouts.length < previewLimit) payouts.push(p);
    }

    return { paidOut, payoutCount, payouts };
  },
});
