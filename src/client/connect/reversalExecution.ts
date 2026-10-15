import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { findCommissionReversal } from "./commissionReceipts.js";

export type ClaimedSlice = {
  stripeTransferId: string;
  /** Cumulative reversed amount this slice starts from. */
  from: number;
  /** Cumulative reversed amount this slice raises the leg to. */
  to: number;
  /** The leg's confirmed `reversedAmount` at claim time. */
  confirmed: number;
  commissionTracked?: boolean;
};

export type ReversalClaim = { replay: boolean; slices: ClaimedSlice[] };

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
export async function executeClaimedSlices(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  operationId: string,
  claim: ReversalClaim,
): Promise<{ reversals: { stripeTransferId: string; amount: number }[] }> {
  const reversals: { stripeTransferId: string; amount: number }[] = [];
  for (const slice of claim.slices) {
    const receiptAmount = slice.to - slice.from;
    if (slice.commissionTracked && claim.replay) {
      const receipt = await findCommissionReversal(
        stripe,
        slice.stripeTransferId,
        operationId,
        receiptAmount,
      );
      if (receipt) {
        await runMutationOrThrow(
          ctx,
          componentRef(component, "connect/mutations/recordTransferReversal"),
          {
            stripeTransferId: slice.stripeTransferId,
            reversedAmount: slice.to,
            receipt: {
              stripeReversalId: receipt.id,
              operationId,
              amount: receiptAmount,
            },
          },
        );
        continue;
      }
      if (slice.confirmed >= slice.to)
        throw new Error("Commission reversal requires receipt reconciliation.");
    }
    if (slice.confirmed >= slice.to) continue; // executed and recorded already

    if (slice.confirmed < slice.from) {
      throw new Error(
        `reversal slice [${slice.from},${slice.to}) on ${slice.stripeTransferId} ` +
          `blocked: predecessor claim unexecuted (confirmed=${slice.confirmed})`,
      );
    }

    if (claim.replay && !slice.commissionTracked) {
      const transfer = await stripe.transfers.retrieve(slice.stripeTransferId);
      if ((transfer.amount_reversed ?? 0) >= slice.to) {
        // The money moved on a previous attempt that died before confirming.
        await runMutationOrThrow(
          ctx,
          componentRef(component, "connect/mutations/recordTransferReversal"),
          {
            stripeTransferId: slice.stripeTransferId,
            reversedAmount: slice.to,
          },
        );
        continue;
      }
    }

    const amount = slice.to - slice.from;
    const receipt = await stripe.transfers.createReversal(
      slice.stripeTransferId,
      {
        amount,
        ...(slice.commissionTracked
          ? { metadata: { bsReversalOperation: operationId } }
          : {}),
      },
      { idempotencyKey: `bs_rev_${operationId}_${slice.stripeTransferId}` },
    );
    await runMutationOrThrow(
      ctx,
      componentRef(component, "connect/mutations/recordTransferReversal"),
      {
        stripeTransferId: slice.stripeTransferId,
        reversedAmount: slice.to,
        ...(slice.commissionTracked
          ? { receipt: { stripeReversalId: receipt.id, operationId, amount } }
          : {}),
      },
    );
    reversals.push({ stripeTransferId: slice.stripeTransferId, amount });
  }
  return { reversals };
}
