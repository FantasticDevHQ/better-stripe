"use client";

import { type ReactNode, useMemo } from "react";

import { CheckoutElementsProvider } from "@stripe/react-stripe-js/checkout";
import { type Appearance, loadStripe } from "@stripe/stripe-js";

import { defaultStripeAppearance } from "../lib/stripe-element-styles.js";

export type CheckoutSessionProviderProps = {
  /** Stripe publishable key (pk_test_... or pk_live_...) */
  publishableKey: string;
  /** Client secret from a Stripe Checkout Session (cs_...) */
  clientSecret: string;
  /** Stripe Appearance object for theming. Defaults to package default. */
  appearance?: Appearance;
  /** Additional Stripe elements options */
  elementsOptions?: Record<string, unknown>;
  children: ReactNode;
};

/**
 * Provider for Stripe Checkout Session custom UI flows.
 *
 * Wraps Stripe's `CheckoutElementsProvider` from `@stripe/react-stripe-js/checkout`
 * (renamed from `CheckoutProvider` in a recent release). Use with
 * `useCheckoutSession()` in child components to access checkout state and
 * confirmation methods.
 *
 * @example
 * ```tsx
 * <CheckoutSessionProvider
 *   publishableKey={pk}
 *   clientSecret={checkoutToken}
 *   appearance={createStripeAppearance({ primary: '#18181b' })}
 * >
 *   <MyCheckoutForm />
 * </CheckoutSessionProvider>
 * ```
 */
export function CheckoutSessionProvider({
  publishableKey,
  clientSecret,
  appearance,
  elementsOptions,
  children,
}: CheckoutSessionProviderProps) {
  const stripePromise = useMemo(
    () => loadStripe(publishableKey),
    [publishableKey],
  );

  const options = useMemo(
    () => ({
      clientSecret,
      elementsOptions: {
        ...elementsOptions,
        // appearance prop always takes precedence over elementsOptions.appearance
        appearance: appearance ?? (defaultStripeAppearance as Appearance),
      },
    }),
    [clientSecret, appearance, elementsOptions],
  );

  return (
    <CheckoutElementsProvider stripe={stripePromise} options={options}>
      {children}
    </CheckoutElementsProvider>
  );
}
