/**
 * Picks the subscription that best represents a buyer's "current plan" for
 * display (`billing.tsx`). A `cancelAtPeriodEnd` sub is only preferred while
 * it's still active/trialing, so a re-subscribed buyer's new subscription
 * wins over a stale canceled one.
 */
export function currentSubscriptionFrom<
  T extends {
    status: string;
    cancelAtPeriodEnd: boolean;
  },
>(subscriptions: T[]) {
  return (
    subscriptions.find(
      (s) =>
        s.cancelAtPeriodEnd &&
        (s.status === "active" || s.status === "trialing"),
    ) ??
    subscriptions.find((s) =>
      ["trialing", "active", "paused", "past_due", "unpaid"].includes(
        s.status,
      ),
    ) ??
    subscriptions[0] ??
    null
  );
}
