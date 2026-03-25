'use client';

import type { ReactNode } from 'react';

export type BillingPortalLinkProps = {
  /** URL to Stripe billing portal (from createBillingPortalSession) */
  portalUrl?: string | null;
  /** Called to create a billing portal session on demand */
  onCreateSession?: () => Promise<string | void>;
  label?: string;
  loadingLabel?: string;
  className?: string;
  children?: (props: {
    url: string | null;
    onClick: () => void;
    isLoading: boolean;
  }) => ReactNode;
};

/**
 * Headless billing portal link/button.
 * Opens Stripe's hosted billing portal for subscription management.
 */
export function BillingPortalLink({
  portalUrl,
  onCreateSession,
  label = 'Manage billing',
  loadingLabel = 'Loading...',
  className,
  children,
}: BillingPortalLinkProps) {
  const handleClick = async () => {
    if (portalUrl) {
      window.open(portalUrl, '_blank');
      return;
    }
    if (onCreateSession) {
      const url = await onCreateSession();
      if (url) {
        window.open(url, '_blank');
      }
    }
  };

  if (children) {
    return (
      <>
        {children({
          url: portalUrl ?? null,
          onClick: handleClick,
          isLoading: false,
        })}
      </>
    );
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {label}
    </button>
  );
}
