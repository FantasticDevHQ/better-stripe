"use client";

import type { ReactNode } from "react";

export type AccountOnboardingButtonRenderProps = {
  /** Call this to continue onboarding */
  onContinue: () => void;
  /** Whether an async action is in progress */
  isLoading: boolean;
  /** Status-aware button label */
  label: string;
  /** Whether the button should be disabled */
  disabled: boolean;
};

export type AccountOnboardingButtonProps = {
  /** Called when the user clicks the button */
  onContinue?: () => void;
  /** Whether an async action is in progress */
  isLoading?: boolean;
  /** Override the default label */
  continueLabel?: string;
  /** Override the loading label */
  loadingLabel?: string;
  /** Additional disabled state (merged with isLoading) */
  disabled?: boolean;
  className?: string;
  /** Full render prop — overrides default button rendering */
  children?: (props: AccountOnboardingButtonRenderProps) => ReactNode;
};

/**
 * Headless button for continuing Stripe Connect account onboarding.
 *
 * All logic lives here:
 * - Default label: "Continue setup" / "Loading..."
 * - Disabled while loading or externally disabled
 *
 * Use standalone, or inside `AccountOnboardingCard`.
 */
export function AccountOnboardingButton({
  onContinue,
  isLoading = false,
  continueLabel,
  loadingLabel,
  disabled: externalDisabled = false,
  className,
  children,
}: AccountOnboardingButtonProps) {
  const defaultLabel = "Continue setup";
  const defaultLoadingLabel = "Loading...";

  const label = isLoading
    ? (loadingLabel ?? defaultLoadingLabel)
    : (continueLabel ?? defaultLabel);
  const disabled = isLoading || externalDisabled;

  const handleContinue = () => onContinue?.();

  if (children) {
    return (
      <>
        {children({
          onContinue: handleContinue,
          isLoading,
          label,
          disabled,
        })}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={handleContinue}
      disabled={disabled}
      className={className}
    >
      {label}
    </button>
  );
}
