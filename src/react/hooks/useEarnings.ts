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

/**
 * Result of the `getAccountEarnings` aggregate query (BTS-64): EXACT totals
 * over the account's whole transfer ledger, plus a bounded preview of rows.
 */
export type AccountEarnings = {
  gross: number;
  reversed: number;
  transferCount: number;
  /** Bounded preview of ledger rows (NOT all of them) — for drill-down UIs. */
  transfers: EarningsTransfer[];
};

/**
 * Result of the `getAccountPayouts` aggregate query (BTS-64): EXACT `paidOut`
 * over the account's whole payout ledger, plus a bounded preview of rows.
 */
export type AccountPayouts = {
  paidOut: number;
  payoutCount: number;
  /** Bounded preview of payout rows (NOT all of them) — for drill-down UIs. */
  payouts: StripeComponentPayout[];
};

export type UseEarningsResult = {
  /** Total transferred to the account (minor units), incl. reinstatements. EXACT. */
  gross: number;
  /**
   * Total pulled back via transfer reversals (minor units) — deferred
   * platform-fee collection plus refund/dispute clawbacks (including
   * clawbacks later reinstated). Not a pure platform-fees figure; a true
   * fees number lives on the payments rows (`feeCollectedAmount`). EXACT.
   */
  reversed: number;
  /** What the recipient actually keeps: gross − reversed. EXACT. */
  net: number;
  /** Total number of transfer rows behind the totals (may exceed `transfers.length`). */
  transferCount: number;
  /**
   * Bounded preview of payout rows (money moving to their bank) — NOT all of
   * them. Use `paidOut`/`payoutCount` for exact figures.
   */
  payouts: StripeComponentPayout[];
  /** Sum of ALL `paid` payouts (minor units). EXACT. */
  paidOut: number;
  /** Total number of payout rows behind `paidOut` (may exceed `payouts.length`). */
  payoutCount: number;
  /**
   * Bounded preview of the underlying transfer rows — NOT all of them. Use the
   * exact totals (`gross`/`reversed`/`net`) for money figures; this is only for
   * drill-down display.
   */
  transfers: EarningsTransfer[];
  isLoading: boolean;
};

/**
 * Factory for a recipient-earnings hook (BTS-36; totals hardened in BTS-64).
 * Reads two server-side AGGREGATE queries — `getAccountEarnings` (the account's
 * transfer ledger, which INCLUDES reinstatement rows) and `getAccountPayouts` —
 * each of which sums the whole ledger server-side and returns EXACT
 * gross/reversed/paidOut regardless of row count, plus a bounded preview of rows
 * for drill-down. The hook surfaces those exact totals verbatim; it does NOT
 * re-sum the (capped) preview rows — that client-side re-summation silently
 * truncated totals for busy accounts before BTS-64.
 *
 * Pass `undefined` to skip both queries (e.g. before the account id is known).
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUseEarnings(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  earningsQueryRef: any,
  payoutsQueryRef: any,
) {
  return function useEarnings(
    accountId: string | undefined,
  ): UseEarningsResult {
    const earnings = useQuery(
      earningsQueryRef,
      accountId ? { destinationAccountId: accountId } : "skip",
    ) as AccountEarnings | undefined;
    const payouts = useQuery(
      payoutsQueryRef,
      accountId ? { accountId } : "skip",
    ) as AccountPayouts | undefined;

    const gross = earnings?.gross ?? 0;
    const reversed = earnings?.reversed ?? 0;

    return {
      gross,
      reversed,
      net: gross - reversed,
      transferCount: earnings?.transferCount ?? 0,
      payouts: payouts?.payouts ?? [],
      paidOut: payouts?.paidOut ?? 0,
      payoutCount: payouts?.payoutCount ?? 0,
      transfers: earnings?.transfers ?? [],
      isLoading:
        accountId !== undefined &&
        (earnings === undefined || payouts === undefined),
    };
  };
}
