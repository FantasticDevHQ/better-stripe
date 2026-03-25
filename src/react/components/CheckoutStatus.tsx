'use client';

import type { ReactNode } from 'react';

export type CheckoutStatusProps = {
  /** Checkout session status */
  status: 'open' | 'complete' | 'expired' | undefined;
  /** Whether data is still loading */
  isLoading?: boolean;
  /** Custom render for each state */
  renderOpen?: () => ReactNode;
  renderComplete?: () => ReactNode;
  renderExpired?: () => ReactNode;
  renderLoading?: () => ReactNode;
  /** Default labels (i18n string overrides) */
  openLabel?: string;
  completeLabel?: string;
  expiredLabel?: string;
  loadingLabel?: string;
  /** CSS class */
  className?: string;
};

/**
 * Headless checkout status display.
 * Renders different content based on checkout session state.
 */
export function CheckoutStatus({
  status,
  isLoading,
  renderOpen,
  renderComplete,
  renderExpired,
  renderLoading,
  openLabel = 'Processing payment...',
  completeLabel = 'Payment successful!',
  expiredLabel = 'Checkout session expired.',
  loadingLabel = 'Loading...',
  className,
}: CheckoutStatusProps) {
  if (isLoading) {
    return (
      <div className={className}>
        {renderLoading ? renderLoading() : <p>{loadingLabel}</p>}
      </div>
    );
  }

  switch (status) {
    case 'open':
      return (
        <div className={className}>
          {renderOpen ? renderOpen() : <p>{openLabel}</p>}
        </div>
      );
    case 'complete':
      return (
        <div className={className}>
          {renderComplete ? renderComplete() : <p>{completeLabel}</p>}
        </div>
      );
    case 'expired':
      return (
        <div className={className}>
          {renderExpired ? renderExpired() : <p>{expiredLabel}</p>}
        </div>
      );
    default:
      return null;
  }
}
