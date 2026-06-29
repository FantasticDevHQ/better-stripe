"use client";

import type { StripeComponentDispute } from "../types.js";

/** Evidence-submission countdown attached by getDisputeWithCountdown (BTS-31). */
export type DisputeEvidenceCountdown = {
  dueBy?: string;
  daysRemaining?: number;
  isOverdue: boolean;
};

/** A dispute plus its evidence-due countdown, as returned by the query. */
export type DisputeWithCountdown = StripeComponentDispute & {
  countdown: DisputeEvidenceCountdown;
};

export type UseDisputeWithCountdownResult = {
  dispute: DisputeWithCountdown | null | undefined;
  countdown: DisputeEvidenceCountdown | null;
  isLoading: boolean;
};

/**
 * Factory for a hook that reads a single dispute together with its evidence
 * countdown (BTS-53) — the one-call surface a DisputeDetail / EvidenceForm UI
 * needs. Pass `undefined` to skip the query (e.g. before an id is known).
 *
 * The `useQuery` binding must support Convex's `"skip"` sentinel.
 */
export function createUseDisputeWithCountdown(
  useQuery: (queryRef: any, args: Record<string, unknown> | "skip") => any,
  queryRef: any,
) {
  return function useDisputeWithCountdown(
    stripeDisputeId: string | undefined,
  ): UseDisputeWithCountdownResult {
    const dispute = useQuery(
      queryRef,
      stripeDisputeId ? { stripeDisputeId } : "skip",
    );

    return {
      dispute: dispute ?? null,
      countdown: dispute?.countdown ?? null,
      isLoading: dispute === undefined && stripeDisputeId !== undefined,
    };
  };
}
