import Stripe from "stripe";

import { assertTestEnvironment } from "./assert-test-env.js";

/**
 * Create a test V2 account in Stripe.
 * Automatically guards against live keys.
 */
export async function createTestAccount(
  stripe: Stripe,
  overrides?: Partial<{
    email: string;
    country: string;
    metadata: Record<string, string>;
  }>,
): Promise<{ id: string }> {
  assertTestEnvironment((stripe as any)._apiKey ?? undefined);

  const account = await (stripe as any).v2.core.accounts.create({
    contact_email: overrides?.email ?? "test@example.com",
    metadata: overrides?.metadata ?? {},
    configuration: {
      customer: { automatic_indirect_tax: { enabled: false } },
    },
  });

  return { id: account.id };
}

/**
 * Create a test product in Stripe.
 */
export async function createTestProduct(
  stripe: Stripe,
  overrides?: Partial<{
    name: string;
    description: string;
    metadata: Record<string, string>;
  }>,
): Promise<Stripe.Product> {
  assertTestEnvironment((stripe as any)._apiKey ?? undefined);

  return await stripe.products.create({
    name: overrides?.name ?? "Test Product",
    description: overrides?.description ?? "A test product for development",
    metadata: overrides?.metadata ?? {},
  });
}

/**
 * Create a test price in Stripe.
 */
export async function createTestPrice(
  stripe: Stripe,
  args: {
    productId: string;
    unitAmount: number;
    currency?: string;
    interval?: "month" | "year";
  },
): Promise<Stripe.Price> {
  assertTestEnvironment((stripe as any)._apiKey ?? undefined);

  const params: Stripe.PriceCreateParams = {
    product: args.productId,
    unit_amount: args.unitAmount,
    currency: args.currency ?? "usd",
  };

  if (args.interval) {
    params.recurring = { interval: args.interval };
  }

  return await stripe.prices.create(params);
}

/**
 * Create a test subscription in Stripe.
 */
export async function createTestSubscription(
  stripe: Stripe,
  args: {
    customerId: string;
    priceId: string;
    trialDays?: number;
  },
): Promise<Stripe.Subscription> {
  assertTestEnvironment((stripe as any)._apiKey ?? undefined);

  return await stripe.subscriptions.create({
    customer: args.customerId,
    items: [{ price: args.priceId }],
    trial_period_days: args.trialDays,
  });
}
