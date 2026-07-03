/**
 * Tests for createUseEarnings (BTS-36) — verifies the factory reads the
 * transfers ledger (listTransfersByAccount — the earnings view, which INCLUDES
 * reinstatement rows) and the payouts table for one recipient account, derives
 * { gross, fees, net, paidOut } in minor units, and skips both queries when
 * the account id is undefined (Convex "skip" sentinel).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseEarnings } from "./useEarnings.js";

const transfersRef = { __brand: "transfersQueryRef" };
const payoutsRef = { __brand: "payoutsQueryRef" };

/** useQuery stub that answers per query ref. */
function useQueryFor(results: Map<unknown, unknown>) {
  return vi.fn((ref: unknown) => results.get(ref));
}

const transfers = [
  // Store leg of a $100 sale, $10 later reversed (deferred platform fee).
  {
    stripeTransferId: "tr_1",
    destinationAccountId: "acct_store",
    amount: 8000,
    reversedAmount: 1000,
    role: "store",
    currency: "usd",
    status: "created",
  },
  // Affiliate-style leg with no reversals.
  {
    stripeTransferId: "tr_2",
    destinationAccountId: "acct_store",
    amount: 500,
    role: "affiliate",
    currency: "usd",
    status: "created",
  },
  // Reinstatement after a won dispute — counts toward earnings.
  {
    stripeTransferId: "tr_3",
    destinationAccountId: "acct_store",
    amount: 2000,
    reinstatement: true,
    currency: "usd",
    status: "created",
  },
];

const payouts = [
  { stripePayoutId: "po_1", accountId: "acct_store", amount: 4000, currency: "usd", status: "paid" },
  { stripePayoutId: "po_2", accountId: "acct_store", amount: 1500, currency: "usd", status: "pending" },
];

describe("createUseEarnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives gross, fees, and net from the account's transfer ledger", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [transfersRef, transfers],
        [payoutsRef, payouts],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, transfersRef, payoutsRef);

    const result = useEarnings("acct_store");

    // gross includes the reinstatement row (earnings view semantics).
    expect(result.gross).toBe(10500);
    // fees = everything pulled back via reversals.
    expect(result.fees).toBe(1000);
    expect(result.net).toBe(9500);
    expect(result.transfers).toBe(transfers);
    expect(result.isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(transfersRef, {
      destinationAccountId: "acct_store",
    });
  });

  it("returns the payout rows and sums only `paid` payouts into paidOut", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [transfersRef, transfers],
        [payoutsRef, payouts],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, transfersRef, payoutsRef);

    const result = useEarnings("acct_store");

    expect(result.payouts).toBe(payouts);
    expect(result.paidOut).toBe(4000);
    expect(mockUseQuery).toHaveBeenCalledWith(payoutsRef, {
      accountId: "acct_store",
    });
  });

  it("reports isLoading while EITHER query is still undefined", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [transfersRef, transfers],
        [payoutsRef, undefined],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, transfersRef, payoutsRef);

    const result = useEarnings("acct_store");

    expect(result.isLoading).toBe(true);
    // Totals for the loaded half are still derived; payouts default empty.
    expect(result.gross).toBe(10500);
    expect(result.payouts).toEqual([]);
    expect(result.paidOut).toBe(0);
  });

  it("skips both queries when the account id is undefined", () => {
    const mockUseQuery = useQueryFor(new Map());
    const useEarnings = createUseEarnings(mockUseQuery, transfersRef, payoutsRef);

    const result = useEarnings(undefined);

    expect(mockUseQuery).toHaveBeenCalledWith(transfersRef, "skip");
    expect(mockUseQuery).toHaveBeenCalledWith(payoutsRef, "skip");
    // A skipped query is not "loading" — there is nothing pending.
    expect(result.isLoading).toBe(false);
    expect(result.gross).toBe(0);
    expect(result.fees).toBe(0);
    expect(result.net).toBe(0);
    expect(result.payouts).toEqual([]);
    expect(result.transfers).toEqual([]);
  });

  it("treats empty ledgers as loaded with zero totals", () => {
    const mockUseQuery = useQueryFor(
      new Map<unknown, unknown>([
        [transfersRef, []],
        [payoutsRef, []],
      ]),
    );
    const useEarnings = createUseEarnings(mockUseQuery, transfersRef, payoutsRef);

    const result = useEarnings("acct_new");

    expect(result.isLoading).toBe(false);
    expect(result.gross).toBe(0);
    expect(result.net).toBe(0);
    expect(result.paidOut).toBe(0);
  });
});
