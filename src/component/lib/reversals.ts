/**
 * Pure reversal-slice math shared by the `claimReversalSlices` mutation (the
 * atomic claim step of BTS-63) and by client-side tests that fake it.
 *
 * A SLICE is a half-open interval [from, to) on a transfer's cumulative
 * reversed-amount axis (the axis Stripe's `Transfer.amount_reversed` moves
 * along). Slices are computed against each leg's claim FRONTIER — the highest
 * cumulative amount any operation has reserved — so operations claiming
 * concurrently can never be handed overlapping money.
 */

export type ReversalMode =
  /** Reverse each leg completely. */
  | { kind: "full" }
  /** Reverse a percentage of each leg's original amount (BTS-25). */
  | { kind: "percent"; percent: number }
  /** Reverse a total amount pro-rata across legs (dispute clawback, BTS-27). */
  | { kind: "amount"; amount: number }
  /**
   * Converge each leg on `round(leg × amountRefunded / chargeAmount)` —
   * cumulative delta-to-target for refunds (BTS-34).
   */
  | { kind: "fraction"; chargeAmount: number; amountRefunded: number };

export type ReversalLeg = {
  stripeTransferId: string;
  /** The leg's original transfer amount (minor units). */
  amount: number;
  /** Claim frontier: max(reversedAmount, reversalClaimedAmount). */
  frontier: number;
};

export type ReversalSlice = {
  stripeTransferId: string;
  from: number;
  to: number;
};

export function computeReversalSlices(
  legs: ReversalLeg[],
  mode: ReversalMode,
): ReversalSlice[] {
  const total = legs.reduce((s, l) => s + l.amount, 0);
  // For `amount` mode, track the remaining budget so rounding can never
  // reverse more than the caller asked for.
  let budget = mode.kind === "amount" ? mode.amount : 0;
  const fraction =
    mode.kind === "fraction" && mode.chargeAmount > 0
      ? Math.min(1, mode.amountRefunded / mode.chargeAmount)
      : 0;

  const slices: ReversalSlice[] = [];
  for (const leg of legs) {
    const from = Math.min(leg.frontier, leg.amount);
    let to: number;
    switch (mode.kind) {
      case "full":
        to = leg.amount;
        break;
      case "percent":
        to = Math.min(
          leg.amount,
          from + Math.round((leg.amount * mode.percent) / 100),
        );
        break;
      case "fraction":
        to = Math.min(leg.amount, Math.max(from, Math.round(leg.amount * fraction)));
        break;
      case "amount": {
        const prorata = total > 0 ? Math.round((mode.amount * leg.amount) / total) : 0;
        const take = Math.max(0, Math.min(prorata, budget, leg.amount - from));
        budget -= take;
        to = from + take;
        break;
      }
    }
    if (to > from) {
      slices.push({ stripeTransferId: leg.stripeTransferId, from, to });
    }
  }
  return slices;
}
