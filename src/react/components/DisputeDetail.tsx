"use client";

import type { ReactNode } from "react";

import type { DisputeWithCountdown } from "../hooks/useDisputeWithCountdown.js";
import { formatPrice } from "../lib/price-helpers.js";

export type DisputeDetailRenderProps = {
  dispute: DisputeWithCountdown;
  /** Formatted dispute amount, e.g. "$120.50". */
  amountLabel: string;
  /** Human countdown message derived from the attached evidence countdown. */
  countdownMessage: string;
  /** Transfers reversed/linked by this dispute (empty when none). */
  linkedTransferIds: string[];
};

export type DisputeDetailProps = {
  /** The dispute + countdown as returned by `useDisputeWithCountdown`. */
  dispute: DisputeWithCountdown | null | undefined;
  isLoading?: boolean;
  /** i18n overrides */
  loadingLabel?: string;
  emptyLabel?: string;
  /** Template for a pending deadline; `{days}` is substituted. */
  dueLabel?: string;
  overdueLabel?: string;
  noDeadlineLabel?: string;
  /** Field captions in the default rendering. */
  labels?: {
    amount?: string;
    reason?: string;
    status?: string;
    evidenceDue?: string;
    linkedTransfers?: string;
  };
  locale?: string;
  className?: string;
  children?: (props: DisputeDetailRenderProps) => ReactNode;
};

/**
 * Headless dispute detail view (BTS-54): amount, reason, status, the
 * evidence-due countdown, and any linked transfers. Countdown math comes from
 * the core `disputeEvidenceCountdown` (attached by `getDisputeWithCountdown`)
 * — this component only phrases it.
 */
export function DisputeDetail({
  dispute,
  isLoading = false,
  loadingLabel = "Loading dispute…",
  emptyLabel = "Dispute not found",
  dueLabel = "Evidence due in {days} days",
  overdueLabel = "Evidence overdue",
  noDeadlineLabel = "No evidence deadline",
  labels,
  locale,
  className,
  children,
}: DisputeDetailProps) {
  if (isLoading) {
    return (
      <div className={className} role="status">
        {loadingLabel}
      </div>
    );
  }
  if (!dispute) {
    return <div className={className}>{emptyLabel}</div>;
  }

  const { countdown } = dispute;
  const countdownMessage = countdown.isOverdue
    ? overdueLabel
    : countdown.daysRemaining !== undefined
      ? dueLabel.replace("{days}", String(countdown.daysRemaining))
      : noDeadlineLabel;

  const renderProps: DisputeDetailRenderProps = {
    dispute,
    amountLabel: formatPrice(dispute.amount, dispute.currency, locale),
    countdownMessage,
    linkedTransferIds: dispute.linkedTransferIds ?? [],
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <div className={className}>
      <dl>
        <dt>{labels?.amount ?? "Amount"}</dt>
        <dd>{renderProps.amountLabel}</dd>
        <dt>{labels?.reason ?? "Reason"}</dt>
        <dd>{dispute.reason}</dd>
        <dt>{labels?.status ?? "Status"}</dt>
        <dd>{dispute.status}</dd>
        <dt>{labels?.evidenceDue ?? "Evidence due"}</dt>
        <dd>{countdownMessage}</dd>
      </dl>
      {renderProps.linkedTransferIds.length > 0 && (
        <ul aria-label={labels?.linkedTransfers ?? "Linked transfers"}>
          {renderProps.linkedTransferIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
