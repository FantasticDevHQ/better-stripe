"use client";

import type { StripeComponentAccount } from "../types.js";

/**
 * Hook to get the Stripe account for a user.
 * Wraps the component's getAccountByUserId query.
 *
 * Note: This is a placeholder that will be connected to the
 * component's public API once the Convex query binding pattern
 * is finalized. Apps should use useQuery(api.stripe.public.getAccountByUserId, { userId })
 * directly until then.
 */
export type UseAccountResult = {
  account: StripeComponentAccount | null | undefined;
  isLoading: boolean;
};

/**
 * Placeholder hook type — consumers pass their own useQuery binding.
 * The actual implementation depends on how the app registers the component.
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
