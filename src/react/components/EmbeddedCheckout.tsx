"use client";

import { useCallback, useMemo } from "react";

import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout as StripeEmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

export type EmbeddedCheckoutProps = {
  /** Stripe publishable key */
  publishableKey: string;
  /** Client secret from createCheckoutSession */
  clientSecret: string;
  /** Called when checkout completes */
  onComplete?: () => void;
  /** CSS class for the wrapper div */
  className?: string;
  /** Custom loading component */
  loadingFallback?: React.ReactNode;
};

/**
 * Headless embedded Stripe checkout component.
 * Renders the Stripe-hosted checkout form inline.
 */
export function EmbeddedCheckout({
  publishableKey,
  clientSecret,
  onComplete,
  className,
  loadingFallback,
}: EmbeddedCheckoutProps) {
  const fetchClientSecret = useCallback(() => {
    return Promise.resolve(clientSecret);
  }, [clientSecret]);

  const stripePromise = useMemo(
    () => loadStripe(publishableKey),
    [publishableKey],
  );

  return (
    <div className={className}>
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret, onComplete }}
      >
        <StripeEmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
