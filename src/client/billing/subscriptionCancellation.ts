import type Stripe from "stripe";

/** Portal cancellation can use cancel_at instead of cancel_at_period_end. */
export function cancelsAtPeriodEnd(subscription: Stripe.Subscription): boolean {
  const periodEnd = subscription.items?.data?.[0]?.current_period_end;
  return (
    subscription.cancel_at_period_end ||
    (periodEnd != null && subscription.cancel_at === periodEnd)
  );
}
