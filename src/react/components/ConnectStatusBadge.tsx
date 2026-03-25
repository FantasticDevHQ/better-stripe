'use client';

import type { ReactNode } from 'react';

export type ConnectStatus =
  | 'pending'
  | 'in_progress'
  | 'complete'
  | 'restricted';

export type ConnectStatusDetails = {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export type ConnectStatusBadgeRenderProps = {
  status: ConnectStatus | undefined;
  label: string;
  statusDetails?: ConnectStatusDetails;
};

export type ConnectStatusBadgeProps = {
  status: ConnectStatus | undefined;
  /** Optional detailed account status for richer rendering */
  statusDetails?: ConnectStatusDetails;
  labels?: Partial<Record<ConnectStatus, string>>;
  className?: string;
  /** Full render prop — overrides all default rendering */
  children?: (props: ConnectStatusBadgeRenderProps) => ReactNode;
};

const DEFAULT_LABELS: Record<ConnectStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  complete: 'Verified',
  restricted: 'Restricted',
};

/**
 * Headless Connect account verification status badge.
 */
export function ConnectStatusBadge({
  status,
  statusDetails,
  labels,
  className,
  children,
}: ConnectStatusBadgeProps) {
  const label = status
    ? (labels?.[status] ?? DEFAULT_LABELS[status])
    : 'Unknown';

  if (children) return <>{children({ status, label, statusDetails })}</>;
  return (
    <span className={className} data-status={status}>
      {label}
    </span>
  );
}
