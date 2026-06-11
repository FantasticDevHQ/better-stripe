"use client";

import type { StripeComponentAccount } from "../types.js";

export type UseAccountResult = {
  account: StripeComponentAccount | null | undefined;
  isLoading: boolean;
};

/**
 * Factory for a hook that gets the Stripe account for a user.
 * Pass the app's `useQuery` binding and a reference to the
 * component's getAccountByUserId query.
 *
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUseAccount(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  queryRef: any,
) {
  return function useAccount(userId: string | undefined): UseAccountResult {
    const account = useQuery(queryRef, userId ? { userId } : "skip");
    return {
      account: account ?? null,
      isLoading: account === undefined && userId !== undefined,
    };
  };
}
