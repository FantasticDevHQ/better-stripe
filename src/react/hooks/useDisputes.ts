"use client";

import type { StripeComponentDispute } from "../types.js";

export type UseDisputesResult = {
  disputes: StripeComponentDispute[] | undefined;
  isLoading: boolean;
};

/**
 * Factory for a hook that lists disputes, optionally filtered by connected
 * account and/or status — the read surface behind the disputes UI (BTS-53).
 */
export function createUseDisputes(
  useQuery: (queryRef: any, args: Record<string, unknown>) => any,
  queryRef: any,
) {
  return function useDisputes(args?: {
    accountId?: string;
    status?: string;
  }): UseDisputesResult {
    const disputes = useQuery(queryRef, args ?? {});
    return {
      disputes,
      isLoading: disputes === undefined,
    };
  };
}
