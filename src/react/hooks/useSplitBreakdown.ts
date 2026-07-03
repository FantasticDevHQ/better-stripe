"use client";

import type { EarningsTransfer } from "./useEarnings.js";

/** One recipient leg of a sale's split, with its post-sale adjustments. */
export type SplitBreakdownLeg = {
  stripeTransferId: string;
  destinationAccountId: string;
  role: "store" | "affiliate" | "other";
  /** The original leg amount (minor units) — the split as executed. */
  amount: number;
  /** Cumulative reversed off this leg (minor units). */
  reversedAmount: number;
  /** amount − reversedAmount. */
  net: number;
  currency: string;
};

/** Per-sale split totals (minor units), shaped for a SplitBreakdown UI. */
export type SplitBreakdownTotals = {
  legs: SplitBreakdownLeg[];
  /** Sum of original store-leg amounts. */
  store: number;
  /** Sum of original affiliate-leg amounts. */
  affiliate: number;
  /** Sum of legs with no/other role. */
  other: number;
  /** store + affiliate + other. */
  recipientsTotal: number;
  /**
   * The platform's share: saleAmount − recipientsTotal (the engine's
   * `platformRetained`). Only derivable when the caller provides the sale
   * amount; undefined otherwise.
   */
  platform?: number;
};

export type UseSplitBreakdownResult = {
  /** null until the ledger rows load (or while skipped). */
  breakdown: SplitBreakdownTotals | null;
  isLoading: boolean;
};

/**
 * Factory for a per-sale split-breakdown hook (BTS-36): reads the sale's
 * original split legs (`listTransfersByCharge` — reinstatement rows are
 * excluded server-side) and sums them by role, with the platform's share
 * derived from the sale amount when provided. Presentation math only — the
 * split itself is computed by the core engine at charge time.
 *
 * Pass `sourceChargeId: undefined` to skip the query. The `useQuery` binding
 * must support Convex's `"skip"` sentinel.
 */
export function createUseSplitBreakdown(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  transfersByChargeQueryRef: any,
) {
  return function useSplitBreakdown(args: {
    sourceChargeId: string | undefined;
    /** The sale's charge total (minor units), for the platform share. */
    saleAmount?: number;
  }): UseSplitBreakdownResult {
    const transfers = useQuery(
      transfersByChargeQueryRef,
      args.sourceChargeId ? { sourceChargeId: args.sourceChargeId } : "skip",
    );

    if (transfers === undefined) {
      return {
        breakdown: null,
        isLoading: args.sourceChargeId !== undefined,
      };
    }

    const legs: SplitBreakdownLeg[] = (transfers as EarningsTransfer[]).map(
      (t) => {
        const reversedAmount = t.reversedAmount ?? 0;
        return {
          stripeTransferId: t.stripeTransferId,
          destinationAccountId: t.destinationAccountId,
          role: t.role ?? "other",
          amount: t.amount,
          reversedAmount,
          net: t.amount - reversedAmount,
          currency: t.currency,
        };
      },
    );

    const sumFor = (role: SplitBreakdownLeg["role"]) =>
      legs.reduce((sum, l) => (l.role === role ? sum + l.amount : sum), 0);
    const store = sumFor("store");
    const affiliate = sumFor("affiliate");
    const other = sumFor("other");
    const recipientsTotal = store + affiliate + other;

    return {
      breakdown: {
        legs,
        store,
        affiliate,
        other,
        recipientsTotal,
        platform:
          args.saleAmount !== undefined
            ? args.saleAmount - recipientsTotal
            : undefined,
      },
      isLoading: false,
    };
  };
}
