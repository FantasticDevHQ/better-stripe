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
  destinationAccountId?: string;
  role?: string;
  currency?: string;
};

/**
 * Reverse the transfers funded by a charge (BTS-25), the primitive used by
 * dispute clawback (M4) and refunds (M5).
 *
 * Reversal sizing, per transfer (exactly one of `percent`/`amount`, or neither):
 *  - `percent`  — reverse that percentage of each transfer's original amount.
 *  - `amount`   — reverse this total across all transfers, pro-rata by size,
 *                 with a remainder pass so the sum never exceeds `amount`.
 *  - neither    — full reversal.
 *
 * Always capped at each transfer's un-reversed remainder, so a fully-reversed
 * transfer is skipped. Pass `operationId` (e.g. a dispute/refund id) so the
 * Stripe reversal carries a stable idempotency key — a retry after a partial
 * run won't double-reverse. The ledger's cumulative `reversedAmount`/
 * `reversalStatus` is updated via `recordTransferReversal`.
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
    const already = t.reversedAmount ?? 0;
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
      opts.operationId
        ? { idempotencyKey: `bs_rev_${opts.operationId}_${t.stripeTransferId}` }
        : undefined,
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
  const reversals: { stripeTransferId: string; amount: number }[] = [];
  if (!(opts.chargeAmount > 0) || !(opts.amountRefunded > 0)) {
    return { reversals };
  }
  const fraction = Math.min(1, opts.amountRefunded / opts.chargeAmount);

  const transfers = ((await ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: opts.sourceChargeId },
  )) ?? []) as LedgerTransfer[];

  for (const t of transfers) {
    const already = t.reversedAmount ?? 0;
    const target = Math.round(t.amount * fraction);
    const delta = Math.min(target, t.amount) - already;
    if (delta <= 0) continue; // target met (or exceeded by a dispute clawback)

    await stripe.transfers.createReversal(
      t.stripeTransferId,
      { amount: delta },
      { idempotencyKey: `bs_rev_${opts.refundId}_${t.stripeTransferId}` },
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/recordTransferReversal"),
      { stripeTransferId: t.stripeTransferId, reversedAmount: already + delta },
    );
    reversals.push({ stripeTransferId: t.stripeTransferId, amount: delta });
  }
  return { reversals };
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
