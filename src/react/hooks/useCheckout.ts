"use client";

import type { StripeComponentCheckoutSession } from "../types.js";

export type UseCheckoutResult = {
  session: StripeComponentCheckoutSession | null | undefined;
  status: "open" | "complete" | "expired" | undefined;
  isLoading: boolean;
  isComplete: boolean;
};

export function createUseCheckout(
  useQuery: (queryRef: any, args: any) => any,
  queryRef: any,
) {
  return function useCheckout(
    sessionId: string | undefined,
  ): UseCheckoutResult {
    const session = sessionId ? useQuery(queryRef, { sessionId }) : undefined;

    return {
      session: session ?? null,
      status: session?.status,
      isLoading: session === undefined && sessionId !== undefined,
      isComplete: session?.status === "complete",
    };
  };
}
