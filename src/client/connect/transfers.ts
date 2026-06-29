import type Stripe from "stripe";

import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";

type LedgerTransfer = {
  stripeTransferId: string;
  amount: number;
  reversedAmount?: number;
};

/**
 * Reverse the transfers funded by a charge (BTS-25), the primitive used by
 * dispute clawback (M4) and refunds (M5).
 *
 * Reversal sizing, per transfer:
 *  - `percent`  — reverse that percentage of each transfer's original amount.
 *  - `amount`   — reverse this total across all transfers, pro-rata by size.
 *  - neither    — full reversal.
 *
 * Always capped at each transfer's un-reversed remainder, so it's idempotent:
 * a transfer already fully reversed is skipped. The ledger's cumulative
 * `reversedAmount`/`reversalStatus` is updated via `recordTransferReversal`.
 */
export async function reverseTransfers(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { sourceChargeId: string; percent?: number; amount?: number },
): Promise<{ reversals: { stripeTransferId: string; amount: number }[] }> {
  const transfers = (await ctx.runQuery(
    componentRef(component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: opts.sourceChargeId },
  )) as LedgerTransfer[];

  const total = transfers.reduce((s, t) => s + t.amount, 0);
  const reversals: { stripeTransferId: string; amount: number }[] = [];

  for (const t of transfers) {
    const already = t.reversedAmount ?? 0;
    const remaining = t.amount - already;
    if (remaining <= 0) continue; // already fully reversed — idempotent

    let reversalAmt: number;
    if (opts.percent !== undefined) {
      reversalAmt = Math.round((t.amount * opts.percent) / 100);
    } else if (opts.amount !== undefined) {
      reversalAmt = total > 0 ? Math.round((opts.amount * t.amount) / total) : 0;
    } else {
      reversalAmt = remaining; // full reversal
    }
    reversalAmt = Math.min(reversalAmt, remaining);
    if (reversalAmt <= 0) continue;

    await stripe.transfers.createReversal(t.stripeTransferId, {
      amount: reversalAmt,
    });
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/recordTransferReversal"),
      { stripeTransferId: t.stripeTransferId, reversedAmount: already + reversalAmt },
    );
    reversals.push({ stripeTransferId: t.stripeTransferId, amount: reversalAmt });
  }

  return { reversals };
}
