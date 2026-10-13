"use client";
import type { ReactNode } from "react";
import { formatPrice } from "../lib/price-helpers.js";
export type ChargeSummaryProps = {
  gross: number;
  fee: number;
  net: number;
  currency: string;
  reconciles: boolean;
  feeLabel?: string;
  children?: (state: {
    metrics: {
      key: "gross" | "fee" | "net";
      label: string;
      amount: number;
      formattedAmount: string;
    }[];
    reconciles: boolean;
  }) => ReactNode;
};
/** Displays a server-calculated charge allocation, without applying a platform fee policy. */
export function ChargeSummary(props: ChargeSummaryProps) {
  const metrics = (
    [
      ["gross", "Charged"],
      ["fee", props.feeLabel ?? "Platform fee"],
      ["net", "Seller payout"],
    ] as const
  ).map(([key, label]) => ({
    key,
    label,
    amount: props[key],
    formattedAmount: formatPrice(props[key], props.currency),
  }));
  if (props.children)
    return <>{props.children({ metrics, reconciles: props.reconciles })}</>;
  return (
    <section data-better-stripe="charge-summary">
      <h2>Charge breakdown</h2>
      <dl>
        {metrics.map((metric) => (
          <div key={metric.key}>
            <dt>{metric.label}</dt>
            <dd>{metric.formattedAmount}</dd>
          </div>
        ))}
      </dl>
      <p role={props.reconciles ? "status" : "alert"}>
        {props.reconciles
          ? "Fee and seller payout reconcile to the charge amount."
          : "Breakdown does not reconcile to the charge amount."}
      </p>
    </section>
  );
}
export type PaymentDetailsPayment = {
  amount: number;
  currency: string;
  status: string;
  refundedAmount?: number;
  refundStatus?: string;
};
export type PaymentDetailsState = {
  payment: PaymentDetailsPayment | null | undefined;
  isLoading: boolean;
  isEmpty: boolean;
  metrics: {
    key: "charged" | "refunded" | "status" | "refundStatus";
    label: string;
    value: string;
  }[];
};
export type PaymentDetailsProps = {
  payment: PaymentDetailsPayment | null | undefined;
  children?: (state: PaymentDetailsState) => ReactNode;
};
export function PaymentDetails({ payment, children }: PaymentDetailsProps) {
  const metrics: PaymentDetailsState["metrics"] = payment
    ? [
        {
          key: "charged",
          label: "Charged",
          value: formatPrice(payment.amount, payment.currency),
        },
        {
          key: "refunded",
          label: "Refunded",
          value: formatPrice(payment.refundedAmount ?? 0, payment.currency),
        },
        { key: "status", label: "Status", value: payment.status },
        {
          key: "refundStatus",
          label: "Refund state",
          value: payment.refundStatus ?? "none",
        },
      ]
    : [];
  const state = {
    payment,
    metrics,
    isLoading: payment === undefined,
    isEmpty: payment === null,
  };
  if (children) return <>{children(state)}</>;
  if (state.isLoading) return <p role="status">Loading payment…</p>;
  if (state.isEmpty) return <p>No payment found.</p>;
  return (
    <dl data-better-stripe="payment-details">
      {metrics.map((metric) => (
        <div key={metric.key}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}
