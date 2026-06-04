"use client";

import type { ReactNode } from "react";

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

  const handleSubmit = async () => {
    if (!stripe || !elements) return;

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    const { error, paymentMethod } = await stripe.createPaymentMethod({
      type: "card",
      card: cardElement,
    });

    if (error) {
      onError?.(error.message ?? "Failed to add card");
    } else if (paymentMethod) {
      onSuccess?.(paymentMethod.id);
    }
  };

  if (children) {
    return (
      <>
        {children({
          handleSubmit,
          isProcessing: false,
          error: null,
        })}
      </>
    );
  }

  return (
    <div className={className}>
      <CardElement />
      <button type="button" onClick={handleSubmit} disabled={!stripe}>
        {submitLabel}
      </button>
    </div>
  );
}
