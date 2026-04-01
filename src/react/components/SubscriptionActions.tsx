"use client";

import type { ReactNode } from "react";

export type SubscriptionActionsRenderProps = {
  onCancel?: () => void;
  onReactivate?: () => void;
  canCancel: boolean;
  canReactivate: boolean;
  isLoading: boolean;
  cancelLabel: string;
  reactivateLabel: string;
};

export type SubscriptionActionsProps = {
  status: string;
  cancelAtPeriodEnd?: boolean;
  onCancel?: () => void;
  onReactivate?: () => void;
  isLoading?: boolean;
  cancelLabel?: string;
  reactivateLabel?: string;
  className?: string;
  children?: (props: SubscriptionActionsRenderProps) => ReactNode;
};

/**
 * Headless subscription action buttons (cancel / reactivate).
 *
 * Logic: determines which action is available based on status and cancelAtPeriodEnd.
 * - Active + not canceling → show cancel button
 * - Active + canceling (cancelAtPeriodEnd) → show reactivate button
 * - Other statuses → no actions
 */
export function SubscriptionActions({
  status,
  cancelAtPeriodEnd = false,
  onCancel,
  onReactivate,
  isLoading = false,
  cancelLabel = "Cancel subscription",
  reactivateLabel = "Reactivate",
  className,
  children,
}: SubscriptionActionsProps) {
  const isActive = status === "active" || status === "trialing";
  const isCanceling = isActive && cancelAtPeriodEnd;
  const canCancel = isActive && !isCanceling && !!onCancel;
  const canReactivate = isCanceling && !!onReactivate;

  const renderProps: SubscriptionActionsRenderProps = {
    onCancel,
    onReactivate,
    canCancel,
    canReactivate,
    isLoading,
    cancelLabel,
    reactivateLabel,
  };

  if (children) {
    return <>{children(renderProps)}</>;
  }

  return (
    <div className={className}>
      {canCancel && (
        <button type="button" disabled={isLoading} onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
      {canReactivate && (
        <button type="button" disabled={isLoading} onClick={onReactivate}>
          {reactivateLabel}
        </button>
      )}
    </div>
  );
}
