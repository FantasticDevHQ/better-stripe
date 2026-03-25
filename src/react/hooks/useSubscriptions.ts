'use client';

import type { StripeComponentSubscription } from '../types.js';

export type UseSubscriptionsResult = {
  subscriptions: StripeComponentSubscription[] | undefined;
  activeSubscription: StripeComponentSubscription | null;
  isLoading: boolean;
};

export function createUseSubscriptions(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function useSubscriptions(args?: {
    userId?: string;
    status?: string;
  }): UseSubscriptionsResult {
    const subscriptions = useQuery(queryRef, args ?? {});

    const activeSubscription =
      subscriptions?.find(
        (s: StripeComponentSubscription) =>
          s.status === 'active' || s.status === 'trialing',
      ) ?? null;

    return {
      subscriptions,
      activeSubscription,
      isLoading: subscriptions === undefined,
    };
  };
}
