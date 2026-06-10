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
 */
export function createUseAccount(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function useAccount(userId: string | undefined): UseAccountResult {
    const account = userId ? useQuery(queryRef, { userId }) : undefined;
    return {
      account: account ?? null,
      isLoading: account === undefined && userId !== undefined,
    };
  };
}
