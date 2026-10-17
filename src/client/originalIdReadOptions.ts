/** Trusted-host exact-ID lookup; uniqueness is not ownership or provider usability. */
export type AccountByStripeIdOptions = {
  stripeAccountId: string;
  requireUnique?: boolean;
};

export type SubscriptionByStripeIdOptions = {
  stripeSubscriptionId: string;
  requireUnique?: boolean;
};
