"use client";
import { formatPrice } from "../lib/price-helpers.js";
import type { ReactNode } from "react";
export type OverviewState = {
  isLoading: boolean;
  totalProducts: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  metrics: { label: string; value: number | string }[];
};
export type OverviewProps = {
  products: unknown[] | undefined;
  subscriptions: { status: string }[] | undefined;
  children?: (state: OverviewState) => ReactNode;
};
export function Overview({ products, subscriptions, children }: OverviewProps) {
  const isLoading = products === undefined || subscriptions === undefined;
  const totalProducts = products?.length ?? 0;
  const totalSubscriptions = subscriptions?.length ?? 0;
  const activeSubscriptions =
    subscriptions?.filter((row) => row.status === "active").length ?? 0;
  const state = {
    isLoading,
    totalProducts,
    totalSubscriptions,
    activeSubscriptions,
    metrics: [
      { label: "Total Subscriptions", value: totalSubscriptions },
      { label: "Active Subscriptions", value: activeSubscriptions },
      { label: "Total Products", value: totalProducts },
      { label: "Data Status", value: isLoading ? "Loading…" : "Live" },
    ],
  };
  if (children) return <>{children(state)}</>;
  return (
    <section data-better-stripe="overview">
      <h2>Overview</h2>
      <dl>
        {state.metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{isLoading ? "Loading…" : metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
/** Totals for one currency only. Upcoming payout amounts are not an account's available/pending Stripe balance. */
export function getPayoutTotals<
  T extends { amount?: number; status: string; currency: string },
>(payouts: T[] | undefined, currency: string) {
  const rows = payouts?.filter((row) => row.currency === currency) ?? [];
  const totalPayouts = rows
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const pendingBalance = rows
    .filter((row) => row.status === "pending" || row.status === "in_transit")
    .reduce((sum, row) => sum + (row.amount ?? 0), 0);
  return {
    totalPayouts,
    pendingBalance,
    totalEarned: totalPayouts + pendingBalance,
    recentPayouts: rows.slice(0, 3),
  };
}

export type PayoutOverviewRow = {
  stripePayoutId: string;
  amount?: number;
  currency: string;
  status: string;
  arrivalDate?: string | null;
};
export type PayoutOverviewProps<
  Row extends PayoutOverviewRow = PayoutOverviewRow,
> = {
  payouts: Row[] | undefined;
  currency: string;
  children?: (
    state: ReturnType<typeof getPayoutTotals<Row>> & {
      isLoading: boolean;
      metrics: { label: string; value: string }[];
    },
  ) => ReactNode;
};
/** Payout activity totals. These amounts are not the available or pending account balance. */
export function PayoutOverview<Row extends PayoutOverviewRow>({
  payouts,
  currency,
  children,
}: PayoutOverviewProps<Row>) {
  const totals = getPayoutTotals(payouts, currency);
  const state = {
    ...totals,
    isLoading: payouts === undefined,
    metrics: [
      {
        label: "Total payouts tracked",
        value: formatPrice(totals.totalEarned, currency),
      },
      {
        label: "Upcoming payouts",
        value: formatPrice(totals.pendingBalance, currency),
      },
      { label: "Paid out", value: formatPrice(totals.totalPayouts, currency) },
    ],
  };
  if (children) return <>{children(state)}</>;
  return (
    <section data-better-stripe="payout-overview">
      <h2>Payout activity</h2>
      <dl>
        {state.metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{state.isLoading ? "Loading…" : metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
