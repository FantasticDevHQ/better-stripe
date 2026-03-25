import { type Infer, v } from 'convex/values';

export const subscriptionStatusValidator = v.union(
  v.literal('active'),
  v.literal('trialing'),
  v.literal('past_due'),
  v.literal('canceled'),
  v.literal('incomplete'),
  v.literal('incomplete_expired'),
  v.literal('unpaid'),
  v.literal('paused'),
);
export type SubscriptionStatus = Infer<typeof subscriptionStatusValidator>;

export const checkoutSessionModeValidator = v.union(
  v.literal('payment'),
  v.literal('subscription'),
  v.literal('setup'),
);
export type CheckoutSessionMode = Infer<typeof checkoutSessionModeValidator>;

export const checkoutSessionStatusValidator = v.union(
  v.literal('open'),
  v.literal('complete'),
  v.literal('expired'),
);
export type CheckoutSessionStatus = Infer<
  typeof checkoutSessionStatusValidator
>;
