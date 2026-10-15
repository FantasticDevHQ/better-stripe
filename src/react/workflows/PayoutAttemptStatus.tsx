"use client";
import type { ReactNode } from "react";
import type { PayoutAttempt } from "../../client/connect/payoutWorker.js";
import {
  payoutAttemptState,
  type PayoutAttemptState,
} from "./payout-attempt-state.js";
export type { PayoutAttemptState } from "./payout-attempt-state.js";
export type PayoutAttemptStatusProps = {
  attempt?: PayoutAttempt | null;
  locale?: string;
  timeZone?: string;
  className?: string;
  children?: (state: PayoutAttemptState) => ReactNode;
};
/** Unstyled worker status. Result times are not bank arrival estimates. */
export function PayoutAttemptStatus({
  attempt,
  locale,
  timeZone,
  className,
  children,
}: PayoutAttemptStatusProps) {
  const state = payoutAttemptState(attempt, locale, timeZone);
  if (!state) return null;
  if (children) return <>{children(state)}</>;
  return (
    <aside
      className={className}
      data-better-stripe="payout-attempt"
      data-tone={state.tone}
    >
      <h3>Latest automatic payout check</h3>
      <p role="status" aria-label="Latest automatic payout attempt">
        {state.message}
      </p>
      {state.formattedAt && (
        <p>
          {state.timeLabel}: {state.formattedAt}
        </p>
      )}
    </aside>
  );
}
