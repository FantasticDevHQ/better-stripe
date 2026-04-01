"use client";

import type { ReactNode } from "react";

export type AccountCloseButtonRenderProps = {
  /** Call this to trigger the close/restart action */
  onClose: () => void;
  /** Whether the async action is in progress */
  isLoading: boolean;
  /** Whether the account is fully onboarded */
  isComplete: boolean;
  /** Status-aware button label */
  label: string;
  /** Whether the button should be disabled */
  disabled: boolean;
};

export type AccountCloseButtonProps = {
  /** Current onboarding status — controls default label */
  status?: "pending" | "in_progress" | "complete" | "restricted";
  /** Called when the user clicks the button */
  onClose?: () => void;
  /** Whether the async action is in progress */
  isLoading?: boolean;
  /** Override the default label */
  closeLabel?: string;
  /** Override the loading label */
  loadingLabel?: string;
  /** Additional disabled state (merged with isLoading) */
  disabled?: boolean;
  className?: string;
  /** Full render prop — overrides default button rendering */
  children?: (props: AccountCloseButtonRenderProps) => ReactNode;
};

/**
 * Headless button for closing or restarting a Stripe Connect account.
 *
 * All status-aware logic lives here:
 * - "Restart onboarding" when onboarding is incomplete
 * - "Close account" when the account is fully set up
 * - Disabled + loading label while the action is in progress
 *
 * Use standalone, in a dialog, or inside `AccountCloseCard`.
 */
export function AccountCloseButton({
  status,
  onClose,
  isLoading = false,
  closeLabel,
  loadingLabel,
  disabled: externalDisabled = false,
  className,
  children,
}: AccountCloseButtonProps) {
  const isComplete = status === "complete";
  const defaultLabel = isComplete ? "Close account" : "Restart onboarding";
  const defaultLoadingLabel = "Closing account...";

  const label = isLoading
    ? (loadingLabel ?? defaultLoadingLabel)
    : (closeLabel ?? defaultLabel);
  const disabled = isLoading || externalDisabled;

  const handleClose = () => onClose?.();

  if (children) {
    return (
      <>
        {children({
          onClose: handleClose,
          isLoading,
          isComplete,
          label,
          disabled,
        })}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClose}
      disabled={disabled}
      className={className}
    >
      {label}
    </button>
  );
}
