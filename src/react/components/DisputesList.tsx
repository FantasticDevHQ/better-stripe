"use client";

import type { ReactNode } from "react";

import type { StripeComponentDispute } from "../types.js";
import type { DisputeEvidenceCountdown } from "../hooks/useDisputeWithCountdown.js";

/**
 * One list row: a dispute, optionally carrying the evidence countdown produced
 * by `getDisputeWithCountdown` / `useDisputeWithCountdown`. The component only
 * renders countdown data — it never recomputes deadlines.
 */
export type DisputesListRow = StripeComponentDispute & {
  countdown?: DisputeEvidenceCountdown;
};

/** Context handed to the `renderRow` slot for each (sorted) row. */
export type DisputesListRowContext = {
  dispute: DisputesListRow;
  countdown: DisputeEvidenceCountdown | undefined;
  /** The default badge text ("Evidence due in N days" / overdue), if any. */
  badgeText: string | undefined;
};

export type DisputesListProps = {
  /** Rows from `useDisputes` (listDisputes), optionally with countdowns. */
  disputes: DisputesListRow[] | undefined;
  isLoading?: boolean;
  className?: string;
  /** i18n overrides */
  emptyLabel?: string;
  loadingLabel?: string;
  dueLabel?: string;
  overdueLabel?: string;
  /** Slot override for a single row; replaces the default `<li>` markup. */
  renderRow?: (row: DisputesListRowContext) => ReactNode;
  /** Render prop replacing the whole list; receives the sorted rows. */
  children?: (props: { disputes: DisputesListRow[] }) => ReactNode;
};

/** Millisecond timestamp of a row's evidence deadline; Infinity when none. */
function dueMs(row: DisputesListRow): number {
  const dueBy = row.countdown?.dueBy ?? row.evidenceDueBy;
  if (!dueBy) return Infinity;
  const ms = new Date(dueBy).getTime();
  return Number.isNaN(ms) ? Infinity : ms;
}

/**
 * Headless list of a seller's disputes (BTS-40), sorted by evidence deadline
 * (soonest first, no-deadline last). Each row shows the dispute status plus a
 * due-by countdown badge fed by the `getDisputeWithCountdown` shape.
 */
export function DisputesList({
  disputes,
  isLoading,
  className,
  emptyLabel = "No disputes",
  loadingLabel = "Loading disputes…",
  dueLabel = "Evidence due in {days} days",
  overdueLabel = "Evidence overdue",
  renderRow,
  children,
}: DisputesListProps) {
  if (disputes === undefined) {
    return isLoading ? <div className={className}>{loadingLabel}</div> : null;
  }

  const sorted = [...disputes].sort((a, b) => dueMs(a) - dueMs(b));

  if (children) {
    return <>{children({ disputes: sorted })}</>;
  }

  if (sorted.length === 0) {
    return <div className={className}>{emptyLabel}</div>;
  }

  const badgeTextFor = (row: DisputesListRow): string | undefined => {
    const countdown = row.countdown;
    if (!countdown?.dueBy) return undefined;
    if (countdown.isOverdue) return overdueLabel;
    return dueLabel.replace("{days}", String(countdown.daysRemaining));
  };

  if (renderRow) {
    return (
      <>
        {sorted.map((dispute) =>
          renderRow({
            dispute,
            countdown: dispute.countdown,
            badgeText: badgeTextFor(dispute),
          }),
        )}
      </>
    );
  }

  return (
    <ul role="list" className={className}>
      {sorted.map((dispute) => {
        const badgeText = badgeTextFor(dispute);
        return (
          <li
            key={dispute.stripeDisputeId}
            data-dispute-id={dispute.stripeDisputeId}
          >
            <span>{dispute.status}</span>
            {badgeText !== undefined && (
              <span role="status" data-overdue={dispute.countdown?.isOverdue}>
                {badgeText}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
