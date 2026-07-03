/**
 * BTS-42 — frontend earnings derivation for the store-earnings demo page.
 *
 * A destination-charge recipient's money lives in their Stripe balance +
 * payouts, NOT the transfer ledger (that ledger, which `useEarnings` reads, is
 * the separate-charges split view and is empty for destination charges). So the
 * figures the merged `EarningsSummary` renders are derived here from the
 * balance snapshot + payout rows instead. Pure + unit-tested (store-earnings.test.ts).
 */

export type BalanceSnapshot = {
  available: number;
  pending: number;
  currency: string;
};

export type StoreEarnings = {
  gross: number;
  reversed: number;
  net: number;
  paidOut: number;
  currency: string;
};

/**
 * gross = funds still held (available + pending) + already paid out; net =
 * gross (destination charges carry no transfer-ledger reversals). `paidOut`
 * counts only settled (`paid`) payouts.
 */
export function earningsFromBalance(
  balance: BalanceSnapshot | null,
  payouts: Array<{ amount: number; status: string; currency: string }>,
): StoreEarnings {
  const held = balance ? balance.available + balance.pending : 0;
  const paidOut = payouts.reduce(
    (sum, p) => (p.status === "paid" ? sum + p.amount : sum),
    0,
  );
  const gross = held + paidOut;
  const currency = balance?.currency ?? payouts[0]?.currency ?? "usd";
  return { gross, reversed: 0, net: gross, paidOut, currency };
}
