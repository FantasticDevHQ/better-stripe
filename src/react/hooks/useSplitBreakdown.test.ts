/**
 * Tests for createUseSplitBreakdown (BTS-36) — verifies the factory reads the
 * original split legs of one sale (listTransfersByCharge — reinstatement rows
 * already excluded server-side), sums them per role (store/affiliate/other),
 * derives the platform's share when the sale amount is provided, and skips the
 * query when the charge id is undefined (Convex "skip" sentinel).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUseSplitBreakdown } from "./useSplitBreakdown.js";

const queryRef = { __brand: "transfersByChargeRef" };

const legs = [
  {
    stripeTransferId: "tr_store",
    destinationAccountId: "acct_store",
    amount: 8000,
    reversedAmount: 1000,
    role: "store",
    currency: "usd",
    status: "created",
  },
  {
    stripeTransferId: "tr_aff",
    destinationAccountId: "acct_affiliate",
    amount: 1000,
    role: "affiliate",
    currency: "usd",
    status: "created",
  },
  // A role-less leg (e.g. legacy destination-charge row) counts as "other".
  {
    stripeTransferId: "tr_misc",
    destinationAccountId: "acct_misc",
    amount: 500,
    currency: "usd",
    status: "created",
  },
];

describe("createUseSplitBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums the legs per role and exposes per-leg net of reversals", () => {
    const mockUseQuery = vi.fn().mockReturnValue(legs);
    const useSplitBreakdown = createUseSplitBreakdown(mockUseQuery, queryRef);

    const { breakdown, isLoading } = useSplitBreakdown({
      sourceChargeId: "ch_1",
    });

    expect(isLoading).toBe(false);
    expect(mockUseQuery).toHaveBeenCalledWith(queryRef, {
      sourceChargeId: "ch_1",
    });
    expect(breakdown).not.toBeNull();
    expect(breakdown!.store).toBe(8000);
    expect(breakdown!.affiliate).toBe(1000);
    expect(breakdown!.other).toBe(500);
    expect(breakdown!.recipientsTotal).toBe(9500);
    expect(breakdown!.legs).toEqual([
      expect.objectContaining({
        stripeTransferId: "tr_store",
        role: "store",
        amount: 8000,
        reversedAmount: 1000,
        net: 7000,
      }),
      expect.objectContaining({
        stripeTransferId: "tr_aff",
        role: "affiliate",
        net: 1000,
      }),
      expect.objectContaining({
        stripeTransferId: "tr_misc",
        role: "other",
        net: 500,
      }),
    ]);
  });

  it("derives the platform share when the sale amount is provided", () => {
    const mockUseQuery = vi.fn().mockReturnValue(legs);
    const useSplitBreakdown = createUseSplitBreakdown(mockUseQuery, queryRef);

    const { breakdown } = useSplitBreakdown({
      sourceChargeId: "ch_1",
      saleAmount: 10000,
    });

    // platformRetained semantics: sale − sum(original legs).
    expect(breakdown!.platform).toBe(500);
  });

  it("leaves the platform share undefined without a sale amount", () => {
    const mockUseQuery = vi.fn().mockReturnValue(legs);
    const useSplitBreakdown = createUseSplitBreakdown(mockUseQuery, queryRef);

    const { breakdown } = useSplitBreakdown({ sourceChargeId: "ch_1" });

    expect(breakdown!.platform).toBeUndefined();
  });

  it("reports isLoading and a null breakdown while the query is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useSplitBreakdown = createUseSplitBreakdown(mockUseQuery, queryRef);

    const { breakdown, isLoading } = useSplitBreakdown({
      sourceChargeId: "ch_1",
    });

    expect(isLoading).toBe(true);
    expect(breakdown).toBeNull();
  });

  it("skips the query when the charge id is undefined", () => {
    const mockUseQuery = vi.fn().mockReturnValue(undefined);
    const useSplitBreakdown = createUseSplitBreakdown(mockUseQuery, queryRef);

    const { breakdown, isLoading } = useSplitBreakdown({
      sourceChargeId: undefined,
    });

    expect(mockUseQuery).toHaveBeenCalledWith(queryRef, "skip");
    expect(isLoading).toBe(false);
    expect(breakdown).toBeNull();
  });

  it("treats a sale with no split legs as loaded (all-platform sale)", () => {
    const mockUseQuery = vi.fn().mockReturnValue([]);
    const useSplitBreakdown = createUseSplitBreakdown(mockUseQuery, queryRef);

    const { breakdown, isLoading } = useSplitBreakdown({
      sourceChargeId: "ch_plain",
      saleAmount: 12900,
    });

    expect(isLoading).toBe(false);
    expect(breakdown).toEqual({
      legs: [],
      store: 0,
      affiliate: 0,
      other: 0,
      recipientsTotal: 0,
      platform: 12900,
    });
  });
});
