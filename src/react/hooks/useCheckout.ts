"use client";

import type { StripeComponentCheckoutSession } from "../types.js";

export type UseCheckoutResult = {
  session: StripeComponentCheckoutSession | null | undefined;
  status: "open" | "complete" | "expired" | undefined;
  isLoading: boolean;
  isComplete: boolean;
};

/**
 * Factory for a hook that tracks a checkout session's status.
 *
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUseCheckout(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  queryRef: any,
) {
  return function useCheckout(
    sessionId: string | undefined,
  ): UseCheckoutResult {
    const session = useQuery(queryRef, sessionId ? { sessionId } : "skip");

    return {
      session: session ?? null,
      status: session?.status,
      isLoading: session === undefined && sessionId !== undefined,
      isComplete: session?.status === "complete",
    };
  };
}
