"use client";

import { useCallback, useRef, useState } from "react";

import { useElements, useStripe } from "@stripe/react-stripe-js";

/**
 * Backend action callbacks for payment method operations.
 * The app provides these — the package handles the Stripe-side orchestration.
 */
export type PaymentMethodActionCallbacks = {
  /** Attach a payment method to the user's account */
  attach: (paymentMethodId: string) => Promise<void>;
  /** Detach a payment method from the user's account */
  detach: (paymentMethodId: string) => Promise<void>;
  /** Set a payment method as the default */
  setDefault: (paymentMethodId: string) => Promise<void>;
  /** Reload the payment methods list after changes */
  reload: () => Promise<void>;
};

export type PaymentMethodCard = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type CreatePaymentMethodResult =
  | {
      success: true;
      paymentMethodId: string;
      card: PaymentMethodCard;
    }
  | { success: false; error: string };

/**
 * Hook that provides payment method action functions.
 *
 * Handles the Stripe-side of creating payment methods (via Elements)
 * and delegates backend operations (attach, detach, set-default) to
 * app-provided callbacks.
 *
 * Must be used inside a `StripeProvider` (Elements context).
 *
 * @example
 * ```tsx
 * const actions = usePaymentMethodActions({
 *   attach: (id) => attachPaymentMethodAction({ paymentMethodId: id }),
 *   detach: (id) => detachPaymentMethodAction({ paymentMethodId: id }),
 *   setDefault: (id) => updateDefaultAction({ paymentMethodId: id }),
 *   reload: () => loadPaymentMethods(),
 * });
 *
 * // Create and attach a new card
 * const result = await actions.createAndAttach();
 * if (result.success) console.log('Added:', result.paymentMethodId);
 *
 * // Detach a card
 * await actions.detach('pm_...');
 *
 * // Set default
 * await actions.setDefault('pm_...');
 * ```
 */
export function usePaymentMethodActions(
  callbacks: PaymentMethodActionCallbacks,
) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to latest callbacks so useCallback deps stay stable
  // even when consumers pass inline objects
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  /**
   * Create a PaymentMethod from the current card element and attach it
   * to the user's account via the provided callback.
   *
   * @param elementType - Which element to read card data from. Defaults to 'cardNumber'.
   */
  const createAndAttach = useCallback(
    async (
      elementType: "card" | "cardNumber" = "cardNumber",
    ): Promise<CreatePaymentMethodResult> => {
      if (!stripe || !elements) {
        const msg = "Stripe not initialized";
        setError(msg);
        return { success: false, error: msg };
      }

      // Dynamically get the right element based on type
      const cardElement =
        elementType === "card"
          ? elements.getElement("card")
          : elements.getElement("cardNumber");

      if (!cardElement) {
        const msg = "Card element not found";
        setError(msg);
        return { success: false, error: msg };
      }

      setIsProcessing(true);
      setError(null);

      try {
        const { paymentMethod, error: stripeError } =
          await stripe.createPaymentMethod({
            type: "card",
            card: cardElement,
          });

        if (stripeError) {
          const msg = stripeError.message ?? "Failed to create payment method";
          setError(msg);
          return { success: false, error: msg };
        }

        if (!paymentMethod) {
          const msg = "No payment method returned";
          setError(msg);
          return { success: false, error: msg };
        }

        // Attach via backend callback
        await callbacksRef.current.attach(paymentMethod.id);

        // Reload list
        await callbacksRef.current.reload();

        const card: PaymentMethodCard = {
          brand: paymentMethod.card?.brand ?? "",
          last4: paymentMethod.card?.last4 ?? "",
          expMonth: paymentMethod.card?.exp_month ?? 0,
          expYear: paymentMethod.card?.exp_year ?? 0,
        };

        return { success: true, paymentMethodId: paymentMethod.id, card };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "An error occurred";
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setIsProcessing(false);
      }
    },
    [stripe, elements],
  );

  /**
   * Detach a payment method and reload the list.
   */
  const detach = useCallback(async (paymentMethodId: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      await callbacksRef.current.detach(paymentMethodId);
      await callbacksRef.current.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to detach";
      setError(msg);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Set a payment method as default and reload the list.
   */
  const setDefault = useCallback(async (paymentMethodId: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      await callbacksRef.current.setDefault(paymentMethodId);
      await callbacksRef.current.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set default";
      setError(msg);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    /** Create a PaymentMethod from Elements and attach it */
    createAndAttach,
    /** Detach a payment method */
    detach,
    /** Set a payment method as default */
    setDefault,
    /** Whether any action is in progress */
    isProcessing,
    /** Last error message, or null */
    error,
    /** Clear the current error */
    clearError: useCallback(() => setError(null), []),
    /** Whether Stripe.js is loaded */
    isReady: !!stripe,
  };
}
