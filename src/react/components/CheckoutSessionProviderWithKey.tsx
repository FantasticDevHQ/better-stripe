'use client';

import type { ReactNode } from 'react';

import type { Appearance } from '@stripe/stripe-js';

import { useStripePublishableKey } from '../hooks/useStripePublishableKey.js';
import { CheckoutSessionProvider } from './CheckoutSessionProvider.js';

export type CheckoutSessionProviderWithKeyProps = {
  /** Convex query ref that returns the Stripe publishable key. */
  publishableKeyQuery: any;
  /** Client secret from a Stripe Checkout Session. */
  clientSecret?: string;
  /** Stripe Appearance object for theming. */
  appearance?: Appearance;
  /** Additional Stripe elements options. */
  elementsOptions?: Record<string, unknown>;
  /** Custom loading renderer. */
  renderLoading?: () => ReactNode;
  /** Custom error renderer. */
  renderError?: (error: string) => ReactNode;
  children: ReactNode;
};

/**
 * Checkout session provider that automatically loads the publishable key
 * from a Convex query and handles loading/error states.
 *
 * Only renders the CheckoutProvider when both key and clientSecret are available.
 *
 * @example
 * ```tsx
 * <CheckoutSessionProviderWithKey
 *   publishableKeyQuery={api.billing.queries.getStripePublishableKey}
 *   clientSecret={checkoutToken}
 *   appearance={createStripeAppearance({ primary: '#18181b' })}
 * >
 *   <MyCheckoutForm />
 * </CheckoutSessionProviderWithKey>
 * ```
 */
export function CheckoutSessionProviderWithKey({
  publishableKeyQuery,
  clientSecret,
  appearance,
  elementsOptions,
  renderLoading,
  renderError,
  children,
}: CheckoutSessionProviderWithKeyProps) {
  const publishableKey = useStripePublishableKey(publishableKeyQuery);

  if (publishableKey === undefined) {
    return renderLoading ? (
      renderLoading()
    ) : (
      <div className="py-4">
        <p className="text-muted-foreground text-center">
          Loading payment form...
        </p>
      </div>
    );
  }

  if (!publishableKey) {
    const msg = 'Stripe configuration error. Please contact support.';
    return renderError ? (
      renderError(msg)
    ) : (
      <div className="border-destructive bg-destructive/10 rounded-lg border p-4">
        <p className="text-destructive text-center text-sm">{msg}</p>
      </div>
    );
  }

  if (!clientSecret) {
    return renderLoading ? (
      renderLoading()
    ) : (
      <div className="py-4">
        <p className="text-muted-foreground text-center">
          Preparing checkout...
        </p>
      </div>
    );
  }

  return (
    <CheckoutSessionProvider
      publishableKey={publishableKey}
      clientSecret={clientSecret}
      appearance={appearance}
      elementsOptions={elementsOptions}
    >
      {children}
    </CheckoutSessionProvider>
  );
}
