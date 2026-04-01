"use client";

import type { ReactNode } from "react";

export type AccountCreateButtonRenderProps = {
  /** Call this to trigger account creation */
  onCreate: () => void;
  /** Whether the creation is in progress */
  isCreating: boolean;
  /** Status-aware button label */
  label: string;
  /** Whether the button should be disabled */
  disabled: boolean;
};

export type AccountCreateButtonProps = {
  /** Called when the user clicks the button */
  onCreate?: () => void;
  /** Whether the creation is in progress */
  isCreating?: boolean;
  /** Override the default label */
  createLabel?: string;
  /** Override the creating label */
  creatingLabel?: string;
  /** Additional disabled state (merged with isCreating) */
  disabled?: boolean;
  className?: string;
  /** Full render prop — overrides default button rendering */
  children?: (props: AccountCreateButtonRenderProps) => ReactNode;
};

/**
 * Headless button for creating a Stripe Connect account.
 *
 * All logic lives here:
 * - Default label: "Create account" / "Creating account..."
 * - Disabled while creating or externally disabled
 *
 * Use standalone, or inside `AccountCreateCard`.
 */
export function AccountCreateButton({
  onCreate,
  isCreating = false,
  createLabel,
  creatingLabel,
  disabled: externalDisabled = false,
  className,
  children,
}: AccountCreateButtonProps) {
  const defaultLabel = "Create account";
  const defaultCreatingLabel = "Creating account...";

  const label = isCreating
    ? (creatingLabel ?? defaultCreatingLabel)
    : (createLabel ?? defaultLabel);
  const disabled = isCreating || externalDisabled;

  const handleCreate = () => onCreate?.();

  if (children) {
    return (
      <>
        {children({
          onCreate: handleCreate,
          isCreating,
          label,
          disabled,
        })}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={disabled}
      className={className}
    >
      {label}
    </button>
  );
}
