import type Stripe from "stripe";
export type CheckoutSessionReadOptions = {
  stripeSessionId: string;
  expand?: string[];
};
export type SubscriptionReadOptions = {
  stripeSubscriptionId: string;
  expand?: string[];
};
export type CouponReadOptions = { stripeCouponId: string; expand?: string[] };
/** Authoritative Stripe objects for authorized server fulfillment/reconciliation. */
export function getCheckoutSessionFromStripe(
  stripe: Stripe,
  opts: CheckoutSessionReadOptions,
) {
  return stripe.checkout.sessions.retrieve(opts.stripeSessionId, {
    expand: opts.expand,
  });
}
export function getSubscriptionFromStripe(
  stripe: Stripe,
  opts: SubscriptionReadOptions,
) {
  return stripe.subscriptions.retrieve(opts.stripeSubscriptionId, {
    expand: opts.expand,
  });
}
export function getCouponFromStripe(stripe: Stripe, opts: CouponReadOptions) {
  return stripe.coupons.retrieve(opts.stripeCouponId, { expand: opts.expand });
}
