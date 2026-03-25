'use client';

import { useCheckout } from '@stripe/react-stripe-js/checkout';

/** Extract error message from Stripe's loosely-typed error objects. */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return fallback;
}

/**
 * Result of a checkout confirmation attempt.
 */
export type CheckoutConfirmResult =
  | { type: 'success' }
  | { type: 'error'; message: string };

/**
 * Checkout session state and actions.
 */
export type CheckoutSessionState =
  | {
      type: 'success';
      /** Stripe checkout session ID */
      sessionId: string;
      /** Whether the checkout form is ready for confirmation */
      canConfirm: boolean;
      /**
       * Confirm the checkout session.
       * @param options - Optional: pass `{ paymentMethod: 'pm_...' }` to use a saved payment method.
       */
      confirm: (options?: {
        paymentMethod?: string;
      }) => Promise<CheckoutConfirmResult>;
    }
  | { type: 'loading' }
  | { type: 'error'; message: string };

/**
 * Hook for accessing Stripe Checkout Session state and actions.
 *
 * Must be used inside a `CheckoutSessionProvider`.
 * Wraps Stripe's `useCheckout()` from `@stripe/react-stripe-js/checkout`
 * with a stable package-owned API.
 *
 * @example
 * ```tsx
 * function MyCheckoutForm() {
 *   const checkout = useCheckoutSession();
 *
 *   if (checkout.type === 'loading') return <Spinner />;
 *   if (checkout.type === 'error') return <p>{checkout.message}</p>;
 *
 *   return (
 *     <>
 *       <PaymentElement />
 *       <button
 *         disabled={!checkout.canConfirm}
 *         onClick={() => checkout.confirm()}
 *       >
 *         Pay
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */
export function useCheckoutSession(): CheckoutSessionState {
  const result = useCheckout();

  if (result.type === 'loading') {
    return { type: 'loading' };
  }

  if (result.type === 'error') {
    const message =
      'error' in result
        ? extractErrorMessage(result.error, 'Checkout failed to load')
        : 'Checkout failed to load';
    return { type: 'error', message };
  }

  return {
    type: 'success',
    sessionId: result.checkout.id,
    canConfirm: result.checkout.canConfirm,
    confirm: async (options) => {
      const confirmResult = await result.checkout.confirm(
        options?.paymentMethod
          ? { paymentMethod: options.paymentMethod }
          : undefined,
      );

      if (confirmResult.type === 'error') {
        const errorMessage =
          'error' in confirmResult
            ? extractErrorMessage(
                confirmResult.error,
                'Payment confirmation failed',
              )
            : 'Payment confirmation failed';
        return { type: 'error', message: errorMessage };
      }

      return { type: 'success' };
    },
  };
}
