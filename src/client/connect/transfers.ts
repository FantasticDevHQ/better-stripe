import type Stripe from "stripe";

import type { SplitRecipient } from "../../component/lib/fees.js";
import { computeSplit, type SplitResult } from "../core/fees.js";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import type { PlatformFeeConfig } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";

type LedgerTransfer = {
  stripeTransferId: string;
  amount: number;
  reversedAmount?: number;
  reversalClaimedAmount?: number;
  destinationAccountId?: string;
  role?: string;
  currency?: string;
};

type ClaimedSlice = {
  stripeTransferId: string;
  /** Cumulative reversed amount this slice starts from. */
  from: number;
  /** Cumulative reversed amount this slice raises the leg to. */
  to: number;
  /** The leg's confirmed `reversedAmount` at claim time. */
  confirmed: number;
};

type ReversalClaim = { replay: boolean; slices: ClaimedSlice[] };

/**
 * Execute the slices an operation claimed via `claimReversalSlices` (BTS-63).
 * The claim already reserved this money atomically, so all that's left is
 * moving it: one `bs_rev_<operationId>_<transferId>` reversal per slice, then
 * confirming the new cumulative total in the ledger. A replayed claim always
 * re-sends byte-identical params under the same key, which Stripe answers
 * from its idempotency cache without moving money twice.
 *
 * Because Stripe prunes idempotency keys after ~24h (and a crash can land
 * between the Stripe call and the ledger confirm), a replay first checks the
 * transfer's live `amount_reversed`: if the slice's money already moved, it
 * just confirms the ledger instead of re-sending the reversal.
 *
 * A slice only executes once every predecessor slice on its leg is confirmed
 * (`confirmed ≥ from`). Without that gate, a sibling operation landing behind
 * a transiently-failed claim would execute and confirm PAST the hole; the
 * failed operation's retry would then see `confirmed ≥ to` and silently skip
 * — its money would never move while the ledger says it did. Throwing instead
 * fails this operation's webhook event, and at-least-once delivery retries
 * both operations until the predecessor fills its hole and each claimed slice
 * has actually moved. The ledger's `reversedAmount` therefore always covers a
 * solid, hole-free prefix of the reversed axis — which is exactly what makes
 * the `confirmed`/`amount_reversed` checks above sound.
 */
async function executeClaimedSlices(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  operationId: string,
  claim: ReversalClaim,
): Promise<{ reversals: { stripeTransferId: string; amount: number }[] }> {
  const reversals: { stripeTransferId: string; amount: number }[] = [];
  for (const slice of claim.slices) {
    if (slice.confirmed >= slice.to) continue; // executed and recorded already

    if (slice.confirmed < slice.from) {
      throw new Error(
        `reversal slice [${slice.from},${slice.to}) on ${slice.stripeTransferId} ` +
          `blocked: predecessor claim unexecuted (confirmed=${slice.confirmed})`,
      );
    }

    if (claim.replay) {
      const transfer = await stripe.transfers.retrieve(slice.stripeTransferId);
      if ((transfer.amount_reversed ?? 0) >= slice.to) {
        // The money moved on a previous attempt that died before confirming.
        await runMutationOrThrow(
          ctx,
          componentRef(component, "connect/mutations/recordTransferReversal"),
          { stripeTransferId: slice.stripeTransferId, reversedAmount: slice.to },
        );
        continue;
      }
    }

    const amount = slice.to - slice.from;
    await stripe.transfers.createReversal(
      slice.stripeTransferId,
      { amount },
      { idempotencyKey: `bs_rev_${operationId}_${slice.stripeTransferId}` },
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/recordTransferReversal"),
      { stripeTransferId: slice.stripeTransferId, reversedAmount: slice.to },
    );
    reversals.push({ stripeTransferId: slice.stripeTransferId, amount });
  }
  return { reversals };
}

/** A wedged reversal claim surfaced by {@link listWedgedReversalClaims}. */
export type WedgedReversalClaim = {
  stripeTransferId: string;
  sourceChargeId?: string;
  amount: number;
  reversedAmount: number;
  reversalClaimedAmount: number;
  blockingOps: { operationId: string; from: number; to: number }[];
};

type ReversalOpRecord = {
  operationId: string;
  sourceChargeId: string;
  slices: { stripeTransferId: string; from: number; to: number }[];
  _creationTime: number;
};

/** Stripe prunes idempotency keys after ~24h; a release must wait past this. */
const REVERSAL_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * List "wedged" reversal legs (BTS-74): legs whose claim frontier
 * (`reversalClaimedAmount`) is stuck ahead of the confirmed `reversedAmount`
 * because the operation that claimed the gap died permanently (its webhook
 * exhausted Stripe's retries and never confirmed). Each entry carries the ops
 * holding the unexecuted slice that blocks every successor on that leg — feed an
 * `operationId` into {@link reclaimReversalClaim} to resolve it.
 *
 * An ops/admin diagnostic: it scans the ledger (see the component query for the
 * exactness/loudness contract), so treat it as a maintenance tool, not a hot path.
 */
export async function listWedgedReversalClaims(
  component: Component,
  ctx: RunCtx,
): Promise<WedgedReversalClaim[]> {
  return (await ctx.runQuery(
    componentRef(component, "connect/queries/listWedgedReversalClaims"),
    {},
  )) as WedgedReversalClaim[];
}

/**
 * Resolve a permanently-dead reversal claim (BTS-74) so it stops blocking
 * successors on the same leg. Two remedies:
 *
 *  - **`reexecute`** (default, always safe): replay the op's recorded slices —
 *    byte-identical Stripe params under the original `bs_rev_<opId>_<transferId>`
 *    idempotency keys — moving any money that never moved and recording any that
 *    moved-but-wasn't-confirmed. This FILLS the hole, so blocked successors
 *    proceed. Prefer this: it can't double-reverse (same keys) and needs no
 *    live-Stripe assumptions.
 *  - **`release`**: abandon the claim entirely — rewind each leg's frontier to
 *    the pre-claim amount and delete the op record, freeing the reserved
 *    capacity. Only safe when the money truly never moved, so it is gated on
 *    BOTH (a) the op being older than `minAgeMs` (default ~24h, past Stripe's
 *    idempotency-key window, so no cached retry can still fire it) AND (b) live
 *    Stripe `amount_reversed ≤ slice.from` on every leg. The component mutation
 *    additionally refuses if a successor already claimed past this op's slice
 *    (releasing would strand it — re-execute instead).
 *
 * `now` is injectable for testing the age gate; it defaults to `Date.now()`.
 */
export async function reclaimReversalClaim(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    operationId: string;
    mode?: "reexecute" | "release";
    minAgeMs?: number;
    now?: number;
  },
): Promise<
  | {
      mode: "reexecute";
      reversals: { stripeTransferId: string; amount: number }[];
    }
  | {
      mode: "release";
      released: boolean;
      rewound: { stripeTransferId: string; to: number }[];
    }
> {
  const op = (await ctx.runQuery(
    componentRef(component, "connect/queries/getReversalOp"),
    { operationId: opts.operationId },
  )) as ReversalOpRecord | null;
  if (!op) {
    throw new Error(
      `reclaimReversalClaim: no reversal op ${opts.operationId} to reclaim`,
    );
  }

  if ((opts.mode ?? "reexecute") === "reexecute") {
    // Build the replay claim DIRECTLY from the recorded op — never recompute.
    // Annotate each recorded slice with its leg's CURRENT confirmed
    // `reversedAmount`, then run executeClaimedSlices: it moves any money that
    // never moved and records any that moved-but-wasn't-confirmed, all under the
    // original `bs_rev_<opId>_<transferId>` keys (so it can't double-reverse).
    // Reading the op straight from the record avoids the frontier-recompute path
    // in claimReversalSlices, which would issue a fresh FULL claim if the op row
    // were concurrently released.
    const slices: ClaimedSlice[] = [];
    for (const s of op.slices) {
      const leg = (await ctx.runQuery(
        componentRef(component, "connect/queries/getTransferByStripeId"),
        { stripeTransferId: s.stripeTransferId },
      )) as { reversedAmount?: number } | null;
      slices.push({ ...s, confirmed: leg?.reversedAmount ?? 0 });
    }
    const { reversals } = await executeClaimedSlices(
      stripe,
      component,
      ctx,
      op.operationId,
      { replay: true, slices },
    );
    return { mode: "reexecute", reversals };
  }

  // release: age-gate against the idempotency window, then verify live Stripe.
  const minAgeMs = opts.minAgeMs ?? REVERSAL_IDEMPOTENCY_WINDOW_MS;
  const now = opts.now ?? Date.now();
  if (now - op._creationTime < minAgeMs) {
    throw new Error(
      `reclaimReversalClaim: op ${op.operationId} is too recent to release ` +
        `(within the ~24h idempotency window); re-execute instead, or wait`,
    );
  }
  const legIds = [...new Set(op.slices.map((s) => s.stripeTransferId))];
  const verified: { stripeTransferId: string; amountReversed: number }[] = [];
  for (const id of legIds) {
    const transfer = await stripe.transfers.retrieve(id);
    verified.push({
      stripeTransferId: id,
      amountReversed: transfer.amount_reversed ?? 0,
    });
  }
  const res = (await runMutationOrThrow(
    ctx,
    componentRef(component, "connect/mutations/releaseReversalClaim"),
    { operationId: op.operationId, verified },
  )) as { released: boolean; rewound: { stripeTransferId: string; to: number }[] };
  return { mode: "release", ...res };
}

/**
 * Reverse the transfers funded by a charge (BTS-25), the primitive used by
 * dispute clawback (M4) and refunds (M5).
 *
 * Reversal sizing, per transfer (exactly one of `percent`/`amount`, or neither):
 *  - `percent`  — reverse that percentage of each transfer's original amount.
 *  - `amount`   — reverse this total across all transfers, pro-rata by size,
 *                 budget-capped so the sum never exceeds `amount`. Rounding
 *                 residue is redistributed to legs with headroom (BTS-102), so
 *                 the reversed total is exactly `min(amount, total headroom)`.
 *  - neither    — full reversal.
 *
 * Always capped at each transfer's un-reversed remainder, so a fully-reversed
 * transfer is skipped.
 *
 * Pass `operationId` (e.g. a dispute/refund id) to make the operation safe
 * under at-least-once webhook delivery AND concurrent siblings (BTS-63): the
 * amounts are claimed atomically in `claimReversalSlices` before any money
 * moves, and every retry replays the originally claimed amounts byte-for-byte
 * under the same `bs_rev_<operationId>_<transferId>` idempotency keys. Without
 * an `operationId` the call is a direct, one-shot reversal with no idempotency
 * protection. The ledger's cumulative `reversedAmount`/`reversalStatus` is
 * updated via `recordTransferReversal`.
 */
export async function reverseTransfers(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    sourceChargeId: string;
    percent?: number;
    amount?: number;
    operationId?: string;
  },
): Promise<{ reversals: { stripeTransferId: string; amount: number }[] }> {
  if (opts.percent !== undefined && opts.amount !== undefined) {
    throw new Error("reverseTransfers: pass at most one of percent or amount");
  }
  if (
    opts.percent !== undefined &&
    (!Number.isFinite(opts.percent) || opts.percent < 0 || opts.percent > 100)
  ) {
    throw new Error("reverseTransfers: percent must be between 0 and 100");
  }
  if (
    opts.amount !== undefined &&
    (!Number.isInteger(opts.amount) || opts.amount < 0)
  ) {
    throw new Error("reverseTransfers: amount must be a non-negative integer");
  }

  if (opts.operationId) {
    const claim = (await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/claimReversalSlices"),
      {
        operationId: opts.operationId,
        sourceChargeId: opts.sourceChargeId,
        mode:
          opts.percent !== undefined
            ? { kind: "percent" as const, percent: opts.percent }
            : opts.amount !== undefined
              ? { kind: "amount" as const, amount: opts.amount }
              : { kind: "full" as const },
      },
    )) as ReversalClaim;
    return executeClaimedSlices(stripe, component, ctx, opts.operationId, claim);
  }

  // Legacy one-shot path (no operationId): size against the claim frontier so
  // a direct call can't double-take money a claimed-but-unexecuted operation
  // already reserved.
  const transfers = ((await ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: opts.sourceChargeId },
  )) ?? []) as LedgerTransfer[];

  const total = transfers.reduce((s, t) => s + t.amount, 0);
  // For the `amount` mode, track the remaining budget so rounding can never
  // reverse more than the caller asked for.
  let amountBudget = opts.amount;
  const reversals: { stripeTransferId: string; amount: number }[] = [];

  for (const t of transfers) {
    const already = Math.max(t.reversedAmount ?? 0, t.reversalClaimedAmount ?? 0);
    const remaining = t.amount - already;
    if (remaining <= 0) continue; // already fully reversed — idempotent

    let reversalAmt: number;
    if (opts.percent !== undefined) {
      reversalAmt = Math.round((t.amount * opts.percent) / 100);
    } else if (amountBudget !== undefined) {
      const prorata = total > 0 ? Math.round((opts.amount! * t.amount) / total) : 0;
      reversalAmt = Math.min(prorata, amountBudget);
    } else {
      reversalAmt = remaining; // full reversal
    }
    reversalAmt = Math.min(reversalAmt, remaining);
    if (reversalAmt <= 0) continue;
    if (amountBudget !== undefined) amountBudget -= reversalAmt;

    await stripe.transfers.createReversal(
      t.stripeTransferId,
      { amount: reversalAmt },
      undefined,
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/recordTransferReversal"),
      { stripeTransferId: t.stripeTransferId, reversedAmount: already + reversalAmt },
    );
    reversals.push({ stripeTransferId: t.stripeTransferId, amount: reversalAmt });
  }

  return { reversals };
}

/**
 * Reverse a split sale's transfers pro-rata to the cumulatively refunded
 * amount (BTS-34) — the refund counterpart of the dispute clawback. Every leg
 * converges on a cumulative reversal TARGET, `round(leg × amountRefunded /
 * chargeAmount)`, and only the delta above the ledger's recorded
 * `reversedAmount` is reversed. Delta-to-target (rather than percent-of-
 * original like {@link reverseTransfers}) is what makes at-least-once webhook
 * delivery safe here: a redelivery whose reversals were recorded computes a
 * zero delta and skips, while a retry after an unrecorded reversal re-sends
 * the IDENTICAL params against the same `bs_rev_<refundId>_<transferId>`
 * idempotency key, which Stripe replays without moving money twice. Multiple
 * partial refunds each raise the target and reverse only their increment.
 * Sales with no ledger legs (non-split) reverse nothing.
 *
 * The delta is claimed atomically in `claimReversalSlices` BEFORE the Stripe
 * call (BTS-63): two DISTINCT refunds processed concurrently serialize on the
 * claim, so they can never both reverse the same target slice — the second
 * claim comes back empty (or with only its own increment).
 */
export async function reverseTransfersForRefund(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    sourceChargeId: string;
    refundId: string;
    /** The original charge amount (minor units). */
    chargeAmount: number;
    /** Stripe's cumulative `charge.amount_refunded`, including this refund. */
    amountRefunded: number;
  },
): Promise<{ reversals: { stripeTransferId: string; amount: number }[] }> {
  if (!(opts.chargeAmount > 0) || !(opts.amountRefunded > 0)) {
    return { reversals: [] };
  }

  const claim = (await runMutationOrThrow(
    ctx,
    componentRef(component, "connect/mutations/claimReversalSlices"),
    {
      operationId: opts.refundId,
      sourceChargeId: opts.sourceChargeId,
      mode: {
        kind: "fraction" as const,
        chargeAmount: opts.chargeAmount,
        amountRefunded: opts.amountRefunded,
      },
    },
  )) as ReversalClaim;
  return executeClaimedSlices(stripe, component, ctx, opts.refundId, claim);
}

/**
 * Webhook-driven split transfer engine (BTS-22). After a charge succeeds for a
 * separate-charges sale, fan funds out to each split recipient: compute the
 * amounts ({@link computeSplit}), create one Stripe `Transfer` per recipient
 * with `source_transaction` linkage, and record each in the ledger. The platform
 * keeps the remainder (`result.platformRetained`, always ≥ 0). No
 * `application_fee` is used on this path.
 */
export async function createSplitTransfers(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    sourceChargeId: string;
    amount: number;
    currency: string;
    split: SplitRecipient[];
    feeConfig?: PlatformFeeConfig;
    paymentId?: string;
  },
): Promise<SplitResult> {
  const result = computeSplit(opts.amount, opts.feeConfig, opts.split);

  // Ledger-level idempotency (BTS-24): skip any (charge, destination, role) leg
  // already recorded, so a webhook retry — even after a partial run — never
  // double-transfers. Complements the deterministic Stripe idempotency key.
  const existing = ((await ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: opts.sourceChargeId },
  )) ?? []) as LedgerTransfer[];
  const done = new Set(
    existing.map((t) => `${t.destinationAccountId}:${t.role ?? ""}`),
  );

  for (const t of result.transfers) {
    if (t.amount <= 0) continue;
    if (done.has(`${t.destinationAccountId}:${t.role}`)) continue;
    const transfer = await stripe.transfers.create(
      {
        amount: t.amount,
        currency: opts.currency,
        destination: t.destinationAccountId,
        source_transaction: opts.sourceChargeId,
        metadata: { bsRole: t.role, bsSourceCharge: opts.sourceChargeId },
      },
      // Deterministic key so a webhook retry can't double-transfer (BTS-24).
      { idempotencyKey: `bs_split_${opts.sourceChargeId}_${t.destinationAccountId}_${t.role}` },
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/upsertTransfer"),
      {
        stripeTransferId: transfer.id,
        sourceChargeId: opts.sourceChargeId,
        destinationAccountId: t.destinationAccountId,
        amount: t.amount,
        currency: opts.currency,
        role: t.role,
        status: "paid" as const,
        paymentId: opts.paymentId,
      },
    );
  }

  return result;
}

/**
 * Re-create transfers for amounts previously reversed by a dispute clawback,
 * when the dispute is won (BTS-29). Stripe reversals are permanent, so winning
 * means paying recipients again from the platform balance (Stripe has credited
 * the disputed funds back). Idempotent via `operationId` (the dispute id) so a
 * `closed`+`funds_reinstated` double-fire won't double-pay. Records each fresh
 * transfer in the ledger.
 */
export async function reinstateTransfers(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { sourceChargeId: string; operationId: string; currency: string },
): Promise<{ reinstated: { destinationAccountId: string; amount: number }[] }> {
  const transfers = ((await ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: opts.sourceChargeId },
  )) ?? []) as LedgerTransfer[];

  const reinstated: { destinationAccountId: string; amount: number }[] = [];
  for (const t of transfers) {
    const amount = t.reversedAmount ?? 0;
    if (amount <= 0) continue; // nothing was clawed back from this leg
    // Use the original leg's currency; fall back to the dispute currency for
    // legacy rows that predate the stored currency — never assume USD.
    const currency = t.currency ?? opts.currency;
    const created = await stripe.transfers.create(
      {
        amount,
        currency,
        destination: t.destinationAccountId!,
        metadata: { bsRole: t.role ?? "", bsReinstateOf: opts.sourceChargeId },
      },
      {
        idempotencyKey: `bs_reinstate_${opts.operationId}_${t.destinationAccountId}_${t.role ?? ""}`,
      },
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/upsertTransfer"),
      {
        stripeTransferId: created.id,
        sourceChargeId: opts.sourceChargeId,
        destinationAccountId: t.destinationAccountId!,
        amount,
        currency,
        role: t.role as "store" | "affiliate" | "other" | undefined,
        status: "paid" as const,
        // Audit-only payout, not an original split leg (kept out of
        // listTransfersByCharge so it can't be re-reversed).
        reinstatement: true,
      },
    );
    reinstated.push({ destinationAccountId: t.destinationAccountId!, amount });
  }
  return { reinstated };
}

/**
 * The original split legs of one sale (`listTransfersByCharge` excludes
 * reinstatement rows), for the `useSplitBreakdown` hook / per-sale breakdown
 * UIs. Read-only passthrough to the component query.
 */
export async function listTransfersByCharge(
  component: Component,
  ctx: RunCtx,
  opts: { sourceChargeId: string; limit?: number },
) {
  return ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    opts,
  );
}

/**
 * A recipient's transfer ledger (the earnings view — includes reinstatements),
 * for the `useEarnings` hook. Read-only passthrough to the component query.
 */
export async function listTransfersByAccount(
  component: Component,
  ctx: RunCtx,
  opts: { destinationAccountId: string; limit?: number },
) {
  return ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByAccount"),
    opts,
  );
}
