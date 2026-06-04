"use client";

import { type ReactNode, useMemo } from "react";

import { Elements } from "@stripe/react-stripe-js";
import { type Appearance, loadStripe } from "@stripe/stripe-js";

import { defaultStripeAppearance } from "../lib/stripe-element-styles.js";

export type StripeProviderProps = {
  /** Stripe publishable key (pk_test_... or pk_live_...) */
  publishableKey: string;
  /** Optional Stripe Appearance API theme. Defaults to neutral light theme. */
  appearance?: Appearance | Record<string, unknown>;
  /** Optional Stripe Elements options such as clientSecret or mode. */
  elementsOptions?: Record<string, unknown>;
  /** @deprecated Use `elementsOptions` instead. */
  stripeOptions?: Record<string, unknown>;
  children: ReactNode;
};

export function createStripeElementsOptions({
  appearance,
  elementsOptions,
  stripeOptions,
}: Pick<
  StripeProviderProps,
  "appearance" | "elementsOptions" | "stripeOptions"
>) {
  return {
    ...stripeOptions,
    ...elementsOptions,
    appearance:
      appearance ??
      (elementsOptions?.appearance as Appearance | undefined) ??
      (stripeOptions?.appearance as Appearance | undefined) ??
      defaultStripeAppearance,
  };
}

/**
 * Headless Stripe Elements provider.
 * Wraps children with Stripe context for embedded checkout, payment forms, etc.
 *
 * @example
 * ```tsx
 * // In Dojo, the publishable key comes from a Convex query via useStripePublishableKey()
 * <StripeProvider publishableKey={publishableKey}>
 *   <EmbeddedCheckout clientSecret={secret} />
 * </StripeProvider>
 * ```
 */
export function StripeProvider({
  publishableKey,
  appearance,
  elementsOptions,
  stripeOptions,
  children,
}: StripeProviderProps) {
  const stripePromise = useMemo(
    () => loadStripe(publishableKey),
    [publishableKey],
  );

  const options = useMemo(
    () =>
      createStripeElementsOptions({
        appearance,
        elementsOptions,
        stripeOptions,
      }),
    [appearance, elementsOptions, stripeOptions],
  );

  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  );
}
