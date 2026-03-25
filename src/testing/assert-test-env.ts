/**
 * Guard that refuses to run test operations against a live Stripe account.
 * Call this before any test fixture creation.
 */
export function assertTestEnvironment(stripeSecretKey?: string): void {
  const key = stripeSecretKey ?? process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error(
      '[better-stripe] STRIPE_SECRET_KEY is not set. Cannot run test fixtures.',
    );
  }

  if (!key.startsWith('sk_test_')) {
    throw new Error(
      '[better-stripe] REFUSING to run test fixtures against a live Stripe account. ' +
        `Key starts with "${key.slice(0, 7)}..." — expected "sk_test_..."`,
    );
  }
}
