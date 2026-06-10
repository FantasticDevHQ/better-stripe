"use client";

import type { StripeComponentProduct } from "../types.js";

export type UseProductsResult = {
  products: StripeComponentProduct[] | undefined;
  isLoading: boolean;
};

export function createUseProducts(
  useQuery: (queryRef: any, args: Record<string, unknown>) => any,
  queryRef: any,
) {
  return function useProducts(args?: {
    accountId?: string;
    active?: boolean;
  }): UseProductsResult {
    const products = useQuery(queryRef, args ?? {});
    return {
      products,
      isLoading: products === undefined,
    };
  };
}
