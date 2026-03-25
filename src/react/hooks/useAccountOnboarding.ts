'use client';

import type { StripeComponentAccount } from '../types.js';

export type UseAccountOnboardingResult = {
  account: StripeComponentAccount | null | undefined;
  status: string | undefined;
  isReady: boolean;
  isLoading: boolean;
  missingRequirements: string[];
};

export function createUseAccountOnboarding(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function useAccountOnboarding(
    accountId: string | undefined,
  ): UseAccountOnboardingResult {
    const account = accountId ? useQuery(queryRef, { accountId }) : undefined;

    return {
      account: account ?? null,
      status: account?.onboardingStatus,
      isReady: account?.onboardingStatus === 'complete',
      isLoading: account === undefined && accountId !== undefined,
      missingRequirements: account?.missingRequirements ?? [],
    };
  };
}
