'use client';

import { deriveSubscriptionState } from '../lib/subscription-helpers.js';
import type { StripeComponentSubscription } from '../types.js';

export type UseSubscriptionResult = {
  subscription: StripeComponentSubscription | null | undefined;
  isLoading: boolean;
  isActive: boolean;
  isTrialing: boolean;
  isCanceling: boolean;
  daysUntilRenewal: number;
  daysUntilTrialEnd: number;
};

export function createUseSubscription(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function useSubscription(
    subscriptionId: string | undefined,
  ): UseSubscriptionResult {
    const subscription = subscriptionId
      ? useQuery(queryRef, { subscriptionId })
      : undefined;

    if (!subscription) {
      return {
        subscription: subscription ?? null,
        isLoading: subscription === undefined && subscriptionId !== undefined,
        isActive: false,
        isTrialing: false,
        isCanceling: false,
        daysUntilRenewal: 0,
        daysUntilTrialEnd: 0,
      };
    }

    const state = deriveSubscriptionState(subscription);
    return {
      subscription,
      isLoading: false,
      ...state,
    };
  };
}
