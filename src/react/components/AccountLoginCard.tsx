'use client';

import type { ReactNode } from 'react';

export type AccountLoginCardRenderProps = {
  onLogin: () => void;
  loginUrl: string | null;
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
  titleLabel = 'Stripe Dashboard',
  descriptionLabel = 'View your earnings, payouts, and account settings.',
  loginLabel = 'Open dashboard',
  className,
  renderStatusBadge,
  renderRequirements,
  renderDashboardLink,
  children,
}: AccountLoginCardProps) {
  const handleLogin = () => {
    if (loginUrl) {
      window.open(loginUrl, '_blank');
    } else {
      onLogin?.();
    }
  };

  if (children) {
    return (
      <>{children({ onLogin: handleLogin, loginUrl: loginUrl ?? null })}</>
    );
  }

  return (
    <div className={className}>
      <div>
        <h3>{titleLabel}</h3>
        {renderStatusBadge?.()}
      </div>
      <p>{descriptionLabel}</p>
      {renderRequirements?.()}
      {renderDashboardLink ? (
        renderDashboardLink({
          url: loginUrl ?? '',
          label: loginLabel,
          onLogin: handleLogin,
        })
      ) : (
        <button type="button" onClick={handleLogin}>
          {loginLabel}
        </button>
      )}
    </div>
  );
}
