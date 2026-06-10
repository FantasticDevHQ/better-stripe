"use client";

import type { StripeComponentAccount } from "../types.js";

export type UseAccountOnboardingResult = {
  account: StripeComponentAccount | null | undefined;
  status: string | undefined;
  isReady: boolean;
  isLoading: boolean;
  missingRequirements: string[];
};

/**
 * Factory for a hook that tracks a Connect account's onboarding progress.
 *
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUseAccountOnboarding(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  queryRef: any,
) {
  return function useAccountOnboarding(
    accountId: string | undefined,
  ): UseAccountOnboardingResult {
    const account = useQuery(queryRef, accountId ? { accountId } : "skip");

    return {
      account: account ?? null,
      status: account?.onboardingStatus,
      isReady: account?.onboardingStatus === "complete",
      isLoading: account === undefined && accountId !== undefined,
      missingRequirements: account?.missingRequirements ?? [],
    };
  };
}
