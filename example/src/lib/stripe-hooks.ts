import {
  createUseEarnings,
  createUseCurrencyEarnings,
  useComponentPaginatedQuery,
  createUseSplitBreakdown,
} from "@fantastic.dev/better-stripe/react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";

/**
 * App-bound instances of the better-stripe hook factories (BTS-36/37). The
 * factories are storage-agnostic — they take Convex's `useQuery` (which honors
 * the `"skip"` sentinel) plus the app-level query wrappers that reach the
 * component's transfer/payout ledgers. Used by the affiliate-split demo
 * (BTS-43).
 */
export const useSplitBreakdown = createUseSplitBreakdown(
  useQuery,
  api.queries.listTransfersByCharge,
);

export const useEarnings = createUseEarnings(
  useQuery,
  api.queries.getAccountEarnings,
  api.queries.getAccountPayouts,
);

export const useCurrencyEarnings = createUseCurrencyEarnings(
  useQuery,
  api.readContracts.getAccountEarningsByCurrency,
  api.readContracts.getAccountPayoutsByCurrency,
);
/** Reactive readers with pinned page boundaries. Keep Products/useProductManager write callbacks. */
export function usePaginatedProducts(accountId?: string) {
  return useComponentPaginatedQuery(
    api.readContracts.paginateProducts,
    { accountId },
    { initialNumItems: 25 },
  );
}
export function usePaginatedPrices(productId: string | undefined) {
  return useComponentPaginatedQuery(
    api.readContracts.paginatePrices,
    productId ? { productId } : "skip",
    { initialNumItems: 25 },
  );
}
export function usePaginatedPayouts(accountId: string | undefined) {
  return useComponentPaginatedQuery(
    api.readContracts.paginatePayouts,
    accountId ? { accountId } : "skip",
    { initialNumItems: 25 },
  );
}
