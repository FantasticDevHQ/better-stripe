"use client";
import type { ReactNode } from "react";
import {
  EarningsSummary,
  type EarningsSummaryProps,
} from "../components/EarningsSummary.js";
import { formatPrice } from "../lib/price-helpers.js";
import { Connect, type ConnectProps } from "./Connect.js";
export type BalanceSnapshot = {
  available: number;
  pending: number;
  currency: string;
};
export type StoreEarnings = {
  gross: number;
  reversed: number;
  net: number;
  paidOut: number;
  currency: string;
};
/** Recipient funds held plus already paid out, not gross charge revenue. Destination-charge balance display only. */
export function earningsFromBalance(
  balance: BalanceSnapshot | null,
  payouts: { amount: number; status: string; currency: string }[],
): StoreEarnings {
  const currency = balance?.currency ?? payouts[0]?.currency ?? "usd";
  const paidOut = payouts
    .filter((row) => row.currency === currency && row.status === "paid")
    .reduce((sum, row) => sum + row.amount, 0);
  const gross = (balance ? balance.available + balance.pending : 0) + paidOut;
  return { gross, reversed: 0, net: gross, paidOut, currency };
}
export type EarningsMetric = {
  key: "gross" | "reversed" | "net" | "paidOut";
  label: string;
  amount: number;
  formattedValue: string;
};
export type EarningsRenderProps = {
  metrics: EarningsMetric[];
  isLoading: boolean;
  currency: string;
  payouts: EarningsSummaryProps["payouts"];
};
export type HeadlessEarningsProps = Omit<EarningsSummaryProps, "children"> & {
  presentation?: "headless";
  children?: (state: EarningsRenderProps) => ReactNode;
};
export type EarningsProps =
  | HeadlessEarningsProps
  | (Omit<ConnectProps, "component"> & { presentation: "embedded" });
export function Earnings(props: EarningsProps) {
  if (props.presentation === "embedded")
    return <Connect {...props} component="balances" />;
  const { children, ...summary } = props;
  const currency = props.currency ?? "usd";
  const metrics: EarningsMetric[] = (
    [
      ["gross", "Gross"],
      ["reversed", "Reversals & adjustments"],
      ["net", "Net"],
      ["paidOut", "Paid out"],
    ] as const
  ).map(([key, label]) => ({
    key,
    label: props.labels?.[key] ?? label,
    amount: props[key],
    formattedValue: formatPrice(props[key], currency, props.locale),
  }));
  return (
    <>
      {children ? (
        children({
          metrics,
          isLoading: props.isLoading ?? false,
          currency,
          payouts: props.payouts,
        })
      ) : (
        <EarningsSummary {...summary} />
      )}
    </>
  );
}
