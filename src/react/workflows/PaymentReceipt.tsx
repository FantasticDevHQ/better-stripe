"use client";
import type { ReactNode } from "react";
import { formatPrice } from "../lib/price-helpers.js";
export type ReceiptPayment = {
  status: string;
  amount: number;
  currency: string;
};
export type PaymentReceiptState = {
  payment: ReceiptPayment | null | undefined;
  isLoading: boolean;
  isConfirmed: boolean;
  title: string;
  message: string;
  amountLabel?: string;
};
export type PaymentReceiptProps = {
  /** Supply authoritative server/webhook data, never a client-confirmation result. */ payment:
    ReceiptPayment | null | undefined;
  children?: (state: PaymentReceiptState) => ReactNode;
};
export function PaymentReceipt({ payment, children }: PaymentReceiptProps) {
  const isConfirmed = payment?.status === "succeeded";
  const state = {
    payment,
    isLoading: !payment,
    isConfirmed,
    title: isConfirmed ? "Payment successful!" : "Payment status",
    message: !payment
      ? "Waiting for Stripe payment confirmation…"
      : isConfirmed
        ? "Your purchase is confirmed by Stripe."
        : `Stripe payment status: ${payment.status}`,
    amountLabel: payment
      ? formatPrice(payment.amount, payment.currency)
      : undefined,
  };
  if (children) return <>{children(state)}</>;
  return (
    <section data-better-stripe="payment-receipt">
      <h2>{state.title}</h2>
      <p role="status">{state.message}</p>
      {state.amountLabel && <p>{state.amountLabel}</p>}
    </section>
  );
}
