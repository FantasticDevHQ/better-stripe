"use client";

import type { StripeComponentPrice } from "../types.js";

export type UsePricesResult = {
  prices: StripeComponentPrice[] | undefined;
  isLoading: boolean;
};

export function createUsePrices(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function usePrices(productId: string | undefined): UsePricesResult {
    const prices = productId ? useQuery(queryRef, { productId }) : undefined;
    return {
      prices,
      isLoading: prices === undefined && productId !== undefined,
    };
  };
}
