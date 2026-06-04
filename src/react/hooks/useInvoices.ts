"use client";

import type { StripeComponentInvoice } from "../types.js";

export type UseInvoicesResult = {
  invoices: StripeComponentInvoice[] | undefined;
  isLoading: boolean;
};

export function createUseInvoices(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function useInvoices(args?: {
    userId?: string;
    subscriptionId?: string;
    status?: string;
  }): UseInvoicesResult {
    const invoices = useQuery(queryRef, args ?? {});
    return {
      invoices,
      isLoading: invoices === undefined,
    };
  };
}
