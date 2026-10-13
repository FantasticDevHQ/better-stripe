"use client";
import type { ReactNode } from "react";
import type { SubscriptionRow } from "./Subscriptions.js";
import { currentSubscriptionFrom } from "./current-subscription.js";
import { SubscriptionCard } from "../components/SubscriptionCard.js";
export type SubscriptionOverviewState<Row> = {
  subscription: Row | null;
  isLoading: boolean;
  isEmpty: boolean;
};
export type SubscriptionOverviewProps<
  Row extends SubscriptionRow = SubscriptionRow,
> = {
  subscriptions: Row[] | undefined;
  children?: (state: SubscriptionOverviewState<Row>) => ReactNode;
};
export function SubscriptionOverview<Row extends SubscriptionRow>({
  subscriptions,
  children,
}: SubscriptionOverviewProps<Row>) {
  const subscription = currentSubscriptionFrom(
    (subscriptions ?? []).map((row) => ({
      ...row,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
    })),
  );
  const state = {
    subscription,
    isLoading: subscriptions === undefined,
    isEmpty: subscriptions !== undefined && !subscription,
  };
  if (children) return <>{children(state)}</>;
  if (state.isLoading) return <p role="status">Loading subscription…</p>;
  if (!subscription) return <p>No subscription yet.</p>;
  return (
    <section data-better-stripe="subscription-overview">
      <h2>Your subscription</h2>
      <p>{subscription.stripeSubscriptionId}</p>
      <SubscriptionCard
        subscription={{
          ...subscription,
          isTrialing:
            subscription.isTrialing ?? subscription.status === "trialing",
        }}
      />
    </section>
  );
}
