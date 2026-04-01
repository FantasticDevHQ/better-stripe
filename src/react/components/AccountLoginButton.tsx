"use client";

import type { ReactNode } from "react";

export type AccountLoginButtonRenderProps = {
  /** Call this to trigger the login action */
  onLogin: () => void;
  /** The login URL, if provided */
  loginUrl: string | null;
  /** Button label */
  label: string;
};

export type AccountLoginButtonProps = {
  /** Called when the user clicks the button (fallback if no loginUrl) */
  onLogin?: () => void;
  /** URL to open in a new tab */
  loginUrl?: string | null;
  /** Override the default label */
  loginLabel?: string;
  className?: string;
  /** Full render prop — overrides default button rendering */
  children?: (props: AccountLoginButtonRenderProps) => ReactNode;
};

/**
 * Headless button for logging into the Stripe Dashboard.
 *
 * All logic lives here:
 * - Opens loginUrl in a new tab if provided
 * - Falls back to calling onLogin
 *
 * Use standalone, or inside `AccountLoginCard`.
 */
export function AccountLoginButton({
  onLogin,
  loginUrl,
  loginLabel,
  className,
  children,
}: AccountLoginButtonProps) {
  const label = loginLabel ?? "Open dashboard";

  const handleLogin = () => {
    if (loginUrl) {
      window.open(loginUrl, "_blank");
    } else {
      onLogin?.();
    }
  };

  if (children) {
    return (
      <>
        {children({
          onLogin: handleLogin,
          loginUrl: loginUrl ?? null,
          label,
        })}
      </>
    );
  }

  return (
    <button type="button" onClick={handleLogin} className={className}>
      {label}
    </button>
  );
}
