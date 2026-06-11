"use client";

import { useCallback } from "react";

import { useElements, useStripe } from "@stripe/react-stripe-js";

/**
 * Normalized result from a Stripe confirmation operation.
 */
export type StripeConfirmResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Hook for confirming a PaymentIntent (immediate charge) or SetupIntent (future charge / trial).
 *
 * Must be used inside a `StripeProvider` (Elements context).
 *
 * @example
 * ```tsx
 * // Confirm a PaymentIntent
 * const { confirmPayment } = useConfirmPayment();
 * const result = await confirmPayment(clientSecret);
 *
 * // Confirm a SetupIntent (trial / save card)
 * const { confirmSetup } = useConfirmPayment();
 * const result = await confirmSetup(clientSecret);
 * ```
 */
export function useConfirmPayment() {
  const stripe = useStripe();
  const elements = useElements();

  /**
   * Confirm a PaymentIntent using card data from a CardElement.
   * @deprecated For PaymentElement-based flows, use `confirmSetup()` instead.
   * This method uses `stripe.confirmCardPayment()` which requires a mounted CardElement.
   */
  const confirmPayment = useCallback(
    async (clientSecret: string): Promise<StripeConfirmResult> => {
      if (!stripe) {
        return { success: false, error: "Stripe not initialized" };
      }

      const { error } = await stripe.confirmCardPayment(clientSecret);
      if (error) {
        return { success: false, error: error.message ?? "Payment failed" };
      }
      return { success: true };
    },
    [stripe],
  );

  /**
   * Confirm a SetupIntent using card data from a CardElement.
   * @deprecated For PaymentElement-based flows, use `confirmSetup()` instead.
   * This method uses `stripe.confirmCardSetup()` which requires a mounted CardElement.
   */
  const confirmCardSetup = useCallback(
    async (clientSecret: string): Promise<StripeConfirmResult> => {
      if (!stripe) {
        return { success: false, error: "Stripe not initialized" };
      }

      const { error } = await stripe.confirmCardSetup(clientSecret);
      if (error) {
        return { success: false, error: error.message ?? "Setup failed" };
      }
      return { success: true };
    },
    [stripe],
  );

  /**
   * Confirm a SetupIntent using the PaymentElement (supports 3D Secure, redirects).
   * This is the modern approach used by add-payment-method dialogs.
   *
   * @param returnUrl - URL to redirect to after 3D Secure. Defaults to current page.
   */
  const confirmSetup = useCallback(
    async (returnUrl?: string): Promise<StripeConfirmResult> => {
      if (!stripe || !elements) {
        return { success: false, error: "Stripe not initialized" };
      }

      const { error } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: returnUrl ?? window.location.href,
        },
        redirect: "if_required",
      });

      if (error) {
        return {
          success: false,
          error: error.message ?? "Failed to confirm setup",
        };
      }
      return { success: true };
    },
    [stripe, elements],
  );

  return {
    /** Confirm a PaymentIntent with card data from Elements */
    confirmPayment,
    /** Confirm a SetupIntent with card data from CardElement */
    confirmCardSetup,
    /** Confirm a SetupIntent with PaymentElement (3D Secure, redirects) */
    confirmSetup,
    /** Whether Stripe.js is loaded and ready */
    isReady: !!stripe,
    /** Whether Elements are available */
    hasElements: !!elements,
  };
}
