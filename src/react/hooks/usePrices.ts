"use client";

import type { StripeComponentPrice } from "../types.js";

export type UsePricesResult = {
  prices: StripeComponentPrice[] | undefined;
  isLoading: boolean;
};

/**
 * Factory for a hook that lists prices for a product.
 *
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUsePrices(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function usePrices(productId: string | undefined): UsePricesResult {
    const prices = useQuery(queryRef, productId ? { productId } : "skip");
    return {
      prices,
      isLoading: prices === undefined && productId !== undefined,
    };
  };
}
