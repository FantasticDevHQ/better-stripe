/**
 * Pure assertion helpers for the money-layer e2e harness (BTS-73).
 *
 * Kept free of any Convex/Stripe imports so BOTH the live harness script
 * (`e2e-webhooks.ts`) and the unit test can use them. The harness reads the
 * persisted ledger and hands the rows here; these functions decide PASS/FAIL.
 */

/** One transfer-ledger row, as far as the reversal assertions care. */
export type TransferRow = {
  role?: string;
  reversedAmount?: number;
};

/**
 * The exact pro-rata reversed amount expected per recipient after a FULL
 * refund / full-amount dispute clawback of the headline $100 split
 * ($80 store + $10 affiliate). Verified against the reversal-slice math
 * (`computeReversalSlices`): a full reversal reverses each leg completely.
 */
export const EXPECTED_REVERSED: Record<string, number> = {
  store: 8_000,
  affiliate: 1_000,
};

/**
 * BTS-73: assert the EXACT reversed amount per recipient, not just
 * `reversedAmount > 0`. True iff the rows are exactly the expected set of roles
 * and each was reversed to precisely its expected amount — so a partial,
 * missing, over-, or wrong-role reversal fails. This is what turns a
 * refund/dispute clawback that "landed but reversed the wrong amount" into a
 * hard FAIL instead of a green-looking pass.
 */
export function reversalsMatchExactly(
  rows: TransferRow[],
  expectedByRole: Record<string, number>,
): boolean {
  const expectedRoles = Object.keys(expectedByRole);
  // Exact set of legs — an unexpected extra leg (or a missing one) fails.
  if (rows.length !== expectedRoles.length) return false;
  for (const role of expectedRoles) {
    const matching = rows.filter((r) => r.role === role);
    if (matching.length !== 1) return false;
    if ((matching[0].reversedAmount ?? 0) !== expectedByRole[role]) return false;
  }
  return true;
}
