"use client";

import type { ReactNode } from "react";

import {
  AccountCloseButton,
  type AccountCloseButtonRenderProps,
} from "./AccountCloseButton.js";

export type AccountCloseCardRenderProps = AccountCloseButtonRenderProps & {
  /** Status-aware title */
  title: string;
  /** Status-aware description */
  description: string;
};

export type AccountCloseCardProps = {
  /** Current onboarding status — controls labels and description */
  status?: "pending" | "in_progress" | "complete" | "restricted";
  /** Called when the user confirms the close/restart action */
  onClose?: () => void;
  /** Whether the async action is in progress */
  isLoading?: boolean;
  /** Label overrides */
  titleLabel?: string;
  descriptionLabel?: string;
  closeLabel?: string;
  className?: string;
  /** Full render prop — overrides all default rendering */
  children?: (props: AccountCloseCardRenderProps) => ReactNode;
};

/**
 * Headless card for closing or restarting a Stripe Connect account.
 *
 * Composes `AccountCloseButton` with status-aware title and description.
 * Use `AccountCloseButton` directly if you don't need the card wrapper.
 */
export function AccountCloseCard({
  status,
  onClose,
  isLoading = false,
  titleLabel,
  descriptionLabel,
  closeLabel,
  className,
  children,
}: AccountCloseCardProps) {
  const isComplete = status === "complete";

  const title =
    titleLabel ?? (isComplete ? "Close Account" : "Restart Onboarding");
  const description =
    descriptionLabel ??
    (isComplete
      ? "Close this Stripe account. This action is irreversible."
      : "Close this Stripe account and start the onboarding process from scratch. This action is irreversible.");

  if (children) {
    return (
      <AccountCloseButton
        status={status}
        onClose={onClose}
        isLoading={isLoading}
        closeLabel={closeLabel}
      >
        {(buttonProps) => children({ ...buttonProps, title, description })}
      </AccountCloseButton>
    );
  }

  return (
    <div className={className}>
      <h3>{title}</h3>
      <p>{description}</p>
      <AccountCloseButton
        status={status}
        onClose={onClose}
        isLoading={isLoading}
        closeLabel={closeLabel}
      />
    </div>
  );
}
