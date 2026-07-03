"use client";

import type { StripeComponentPayout } from "../types.js";

/**
 * A row from the component's transfers ledger, as the earnings/split hooks
 * read it (subset of the `transfers` table document).
 */
export type EarningsTransfer = {
  _id?: string;
  _creationTime?: number;
  stripeTransferId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  status: string;
  /** Which leg of a split this was (store | affiliate | other). */
  role?: "store" | "affiliate" | "other";
  /** Cumulative amount pulled back via reversals (minor units). */
  reversedAmount?: number;
  reversalStatus?: string;
  /** True for re-payment transfers after a won dispute (earnings, not a split leg). */
  reinstatement?: boolean;
  sourceChargeId?: string;
  sourceInvoiceId?: string;
  paymentId?: string;
  metadata?: unknown;
};

export type UseEarningsResult = {
  /** Total transferred to the account (minor units), incl. reinstatements. */
  gross: number;
  /**
   * Total pulled back via transfer reversals (minor units) — deferred
   * platform-fee collection plus refund/dispute clawbacks (including
   * clawbacks later reinstated). Not a pure platform-fees figure; a true
   * fees number lives on the payments rows (`feeCollectedAmount`).
   */
  reversed: number;
  /** What the recipient actually keeps: gross − reversed. */
  net: number;
  /** Payout rows for the account (money moving to their bank). */
  payouts: StripeComponentPayout[];
  /** Sum of `paid` payouts (minor units). */
  paidOut: number;
  /** The underlying ledger rows, for drill-down UIs. */
  transfers: EarningsTransfer[];
  isLoading: boolean;
};

/**
 * Factory for a recipient-earnings hook (BTS-36): reads the account's transfer
 * ledger (`listTransfersByAccount` — the earnings view, which INCLUDES
 * reinstatement rows) and its payouts, and derives gross / reversed / net in minor
 * units. Amount math assumes one currency per account (true for the seeded
 * demo); rows carry `currency` for consumers that need to segregate.
 *
 * Pass `undefined` to skip both queries (e.g. before the account id is known).
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUseEarnings(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  transfersQueryRef: any,
  payoutsQueryRef: any,
) {
  return function useEarnings(
    accountId: string | undefined,
  ): UseEarningsResult {
    const transfers = useQuery(
      transfersQueryRef,
      accountId ? { destinationAccountId: accountId } : "skip",
    );
    const payouts = useQuery(
      payoutsQueryRef,
      accountId ? { accountId } : "skip",
    );

    const rows: EarningsTransfer[] = transfers ?? [];
    const payoutRows: StripeComponentPayout[] = payouts ?? [];

    const gross = rows.reduce((sum, t) => sum + t.amount, 0);
    const reversed = rows.reduce((sum, t) => sum + (t.reversedAmount ?? 0), 0);
    const paidOut = payoutRows.reduce(
      (sum, p) => (p.status === "paid" ? sum + p.amount : sum),
      0,
    );

    return {
      gross,
      reversed,
      net: gross - reversed,
      payouts: payoutRows,
      paidOut,
      transfers: rows,
      isLoading:
        accountId !== undefined &&
        (transfers === undefined || payouts === undefined),
    };
  };
}
