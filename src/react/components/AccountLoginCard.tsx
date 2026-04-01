"use client";

import type { ReactNode } from "react";

import {
  AccountLoginButton,
  type AccountLoginButtonRenderProps,
} from "./AccountLoginButton.js";

export type AccountLoginCardRenderProps = AccountLoginButtonRenderProps & {
  /** Card title */
  title: string;
  /** Card description */
  description: string;
};

export type AccountLoginCardProps = {
  onLogin?: () => void;
  loginUrl?: string | null;
  titleLabel?: string;
  descriptionLabel?: string;
  loginLabel?: string;
  className?: string;
  /** Render prop for a status badge area */
  renderStatusBadge?: () => ReactNode;
  /** Render prop for a requirements section */
  renderRequirements?: () => ReactNode;
  /** Render prop for a custom dashboard link/button */
  renderDashboardLink?: (props: {
    url: string;
    label: string;
    onLogin: () => void;
  }) => ReactNode;
  /** Full render prop — overrides all default rendering */
  children?: (props: AccountLoginCardRenderProps) => ReactNode;
};

/**
 * Headless Stripe Connect dashboard login card.
 */
export function AccountLoginCard({
  onLogin,
  loginUrl,
  titleLabel = "Stripe Dashboard",
  descriptionLabel = "View your earnings, payouts, and account settings.",
  loginLabel = "Open dashboard",
  className,
  renderStatusBadge,
  renderRequirements,
  renderDashboardLink,
  children,
}: AccountLoginCardProps) {
  const title = titleLabel;
  const description = descriptionLabel;

  if (children) {
    return (
      <AccountLoginButton
        onLogin={onLogin}
        loginUrl={loginUrl}
        loginLabel={loginLabel}
      >
        {(buttonProps) => children({ ...buttonProps, title, description })}
      </AccountLoginButton>
    );
  }

  return (
    <div className={className}>
      <div>
        <h3>{title}</h3>
        {renderStatusBadge?.()}
      </div>
      <p>{description}</p>
      {renderRequirements?.()}
      {renderDashboardLink ? (
        <AccountLoginButton
          onLogin={onLogin}
          loginUrl={loginUrl}
          loginLabel={loginLabel}
        >
          {({ onLogin: handleLogin }) =>
            renderDashboardLink({
              url: loginUrl ?? "",
              label: loginLabel,
              onLogin: handleLogin,
            })
          }
        </AccountLoginButton>
      ) : (
        <AccountLoginButton
          onLogin={onLogin}
          loginUrl={loginUrl}
          loginLabel={loginLabel}
        />
      )}
    </div>
  );
}
