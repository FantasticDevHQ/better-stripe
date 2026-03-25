'use client';

import { type ReactNode, useEffect, useState } from 'react';

import type { Appearance } from '@stripe/stripe-js';

import { useStripePublishableKey } from '../hooks/useStripePublishableKey.js';
import { StripeProvider } from './StripeProvider.js';

export type StripeProviderWithKeyProps = {
  /** Convex query ref that returns the Stripe publishable key. */
  publishableKeyQuery: any;
  /** Stripe Appearance object for theming. */
  appearance?: Appearance | Record<string, unknown>;
  /** Optional Stripe Elements options such as clientSecret or mode. */
  elementsOptions?: Record<string, unknown>;
  /** Optional client secret to include in elements options. */
  clientSecret?: string;
  /** Custom loading renderer. Defaults to centered "Loading payment form..." text. */
  renderLoading?: () => ReactNode;
  /** Custom error renderer. Defaults to a red error banner. */
  renderError?: (error: string) => ReactNode;
  children: ReactNode;
};

function DefaultLoading() {
  return (
    <div className="py-4">
      <p className="text-muted-foreground text-center">
        Loading payment form...
      </p>
    </div>
  );
}

function DefaultError({ message }: { message: string }) {
  return (
    <div className="border-destructive bg-destructive/10 rounded-lg border p-4">
      <p className="text-destructive text-center text-sm">{message}</p>
    </div>
  );
}

/**
 * Stripe Elements provider that automatically loads the publishable key
 * from a Convex query and handles loading/error states.
 *
 * @example
 * ```tsx
 * <StripeProviderWithKey
 *   publishableKeyQuery={api.billing.queries.getStripePublishableKey}
 *   appearance={createStripeAppearance({ baseTheme: 'flat' })}
 * >
 *   <AddCardForm onSubmit={handleSubmit} />
 * </StripeProviderWithKey>
 * ```
 */
export function StripeProviderWithKey({
  publishableKeyQuery,
  appearance,
  elementsOptions,
  clientSecret,
  renderLoading,
  renderError,
  children,
}: StripeProviderWithKeyProps) {
  const publishableKey = useStripePublishableKey(publishableKeyQuery);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || publishableKey === undefined) {
    return renderLoading ? renderLoading() : <DefaultLoading />;
  }

  if (!publishableKey) {
    const msg = 'Stripe configuration error. Please contact support.';
    return renderError ? renderError(msg) : <DefaultError message={msg} />;
  }

  return (
    <StripeProvider
      publishableKey={publishableKey}
      appearance={appearance}
      elementsOptions={{
        ...elementsOptions,
        ...(clientSecret ? { clientSecret } : {}),
      }}
    >
      {children}
    </StripeProvider>
  );
}
