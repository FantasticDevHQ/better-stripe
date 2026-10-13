"use client";
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
