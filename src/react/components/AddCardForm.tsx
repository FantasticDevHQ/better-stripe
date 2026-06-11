"use client";

import { type ReactNode, useState } from "react";

import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";

export type AddCardFormProps = {
  onSuccess?: (paymentMethodId: string) => void;
  onError?: (error: string) => void;
  submitLabel?: string;
  className?: string;
  children?: (props: {
    handleSubmit: () => Promise<void>;
    isProcessing: boolean;
    error: string | null;
  }) => ReactNode;
};

/**
 * Headless add card / payment method form.
 * Must be rendered inside a StripeProvider.
 */
export function AddCardForm({
  onSuccess,
  onError,
  submitLabel = "Add card",
  className,
  children,
}: AddCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements || isProcessing) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setIsProcessing(true);
    setError(null);
    try {
      const { error: stripeError, paymentMethod } =
        await stripe.createPaymentMethod({ type: "card", card: cardElement });
      if (stripeError) {
        const message = stripeError.message ?? "Failed to add card";
        setError(message);
        onError?.(message);
      } else if (paymentMethod) {
        onSuccess?.(paymentMethod.id);
      }
    } catch (err) {
      // createPaymentMethod normally resolves with { error }, but network
      // failures and timeouts reject — surface those the same way.
      const message = err instanceof Error ? err.message : "Failed to add card";
      setError(message);
      onError?.(message);
    } finally {
      setIsProcessing(false);
    }
  };

  if (children) {
    return <>{children({ handleSubmit, isProcessing, error })}</>;
  }

  return (
    <div className={className}>
      <CardElement />
      {error && <div role="alert">{error}</div>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!stripe || isProcessing}
      >
        {submitLabel}
      </button>
    </div>
  );
}
