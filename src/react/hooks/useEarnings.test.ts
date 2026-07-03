/**
 * Tests for createUseEarnings (BTS-36, hardened in BTS-64). The hook reads two
 * server-side AGGREGATE queries — one for the transfer ledger, one for payouts —
 * each of which returns EXACT totals (summed to completion server-side, never
 * capped) plus a bounded preview of rows for drill-down. The hook must surface
 * the exact totals verbatim and must NOT re-sum the (capped) preview rows — that
 * client-side re-summation was the BTS-64 truncation bug.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseEarnings } from "./useEarnings.js";

const earningsRef = { __brand: "earningsQueryRef" };
const payoutsRef = { __brand: "payoutsQueryRef" };

/** useQuery stub that answers per query ref. */
function useQueryFor(results: Map<unknown, unknown>) {
  return vi.fn((ref: unknown) => results.get(ref));
}

// Preview rows are a bounded slice; the totals below deliberately EXCEED what
// summing these two rows would give, proving the hook trusts the exact totals.
const previewTransfers = [
  {
    stripeTransferId: "tr_1",
    destinationAccountId: "acct_store",
    amount: 8000,
    reversedAmount: 1000,
    role: "store",
    currency: "usd",
    status: "created",
  },
  {
    stripeTransferId: "tr_2",
    destinationAccountId: "acct_store",
    amount: 500,
    role: "affiliate",
    currency: "usd",
    status: "created",
  },
];

const earningsResult = {
  gross: 10500,
  reversed: 1000,
  transferCount: 137, // > preview length: totals are exact, rows are capped
  transfers: previewTransfers,
};

const previewPayouts = [
  { stripePayoutId: "po_1", accountId: "acct_store", amount: 4000, currency: "usd", status: "paid" },
  { stripePayoutId: "po_2", accountId: "acct_store", amount: 1500, currency: "usd", status: "pending" },
];

const payoutsResult = {
  paidOut: 4000,
  payoutCount: 88, // > preview length
  payouts: previewPayouts,
};

describe("createUseEarnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces the EXACT server-side totals, not a re-sum of the capped preview", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [earningsRef, earningsResult],
        [payoutsRef, payoutsResult],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, earningsRef, payoutsRef);

    const result = useEarnings("acct_store");

    expect(result.gross).toBe(10500);
    expect(result.reversed).toBe(1000);
    expect(result.net).toBe(9500);
    expect(result.transferCount).toBe(137);
    expect(result.transfers).toBe(previewTransfers);
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(earningsRef, {
      destinationAccountId: "acct_store",
    });
  });

  it("surfaces exact paidOut and the payout preview rows and count", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [earningsRef, earningsResult],
        [payoutsRef, payoutsResult],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, earningsRef, payoutsRef);

    const result = useEarnings("acct_store");

    expect(result.payouts).toBe(previewPayouts);
    expect(result.paidOut).toBe(4000);
    expect(result.payoutCount).toBe(88);
    expect(mockUseQuery).toHaveBeenCalledWith(payoutsRef, {
      accountId: "acct_store",
    });
  });

  it("reports isLoading while EITHER query is still undefined", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [earningsRef, earningsResult],
        [payoutsRef, undefined],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, earningsRef, payoutsRef);

    const result = useEarnings("acct_store");

    expect(result.isLoading).toBe(true);
    // The loaded half's exact totals still surface; payouts default to zero/empty.
    expect(result.gross).toBe(10500);
    expect(result.payouts).toEqual([]);
    expect(result.paidOut).toBe(0);
    expect(result.payoutCount).toBe(0);
  });

  it("skips both queries when the account id is undefined", () => {
    const mockUseQuery = useQueryFor(new Map());
    const useEarnings = createUseEarnings(mockUseQuery, earningsRef, payoutsRef);

    const result = useEarnings(undefined);

    expect(mockUseQuery).toHaveBeenCalledWith(earningsRef, "skip");
    expect(mockUseQuery).toHaveBeenCalledWith(payoutsRef, "skip");
    expect(result.isLoading).toBe(false);
    expect(result.gross).toBe(0);
    expect(result.reversed).toBe(0);
    expect(result.net).toBe(0);
    expect(result.transferCount).toBe(0);
    expect(result.payouts).toEqual([]);
    expect(result.transfers).toEqual([]);
  });

  it("treats empty ledgers as loaded with zero totals", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [earningsRef, { gross: 0, reversed: 0, transferCount: 0, transfers: [] }],
        [payoutsRef, { paidOut: 0, payoutCount: 0, payouts: [] }],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, earningsRef, payoutsRef);

    const result = useEarnings("acct_new");

    expect(result.isLoading).toBe(false);
    expect(result.gross).toBe(0);
    expect(result.net).toBe(0);
    expect(result.paidOut).toBe(0);
  });
});
