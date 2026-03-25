import type Stripe from 'stripe';

import type { RunCtx } from '../helpers.js';

// =============================================================================
// Webhook endpoint management
// =============================================================================

/**
 * All Stripe event types the better-stripe webhook handler processes.
 * Use this when creating webhook endpoints to ensure all needed events are enabled.
 */
export const BETTER_STRIPE_WEBHOOK_EVENTS = [
  // Products & Prices
  'product.created',
  'product.updated',
  'price.created',
  'price.updated',
  // Subscriptions
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  // Checkout
  'checkout.session.completed',
  // Invoices
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  // Payments
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  // Payouts
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
] as const;

export type BetterStripeWebhookEvent =
  (typeof BETTER_STRIPE_WEBHOOK_EVENTS)[number];

export async function listWebhookEndpoints(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: { limit?: number },
) {
  const endpoints = await stripe.webhookEndpoints.list({
    limit: opts?.limit ?? 100,
  });
  return endpoints.data.map((ep) => ({
    id: ep.id,
    url: ep.url,
    status: ep.status,
    enabledEvents: ep.enabled_events,
    description: ep.description ?? undefined,
    livemode: ep.livemode,
  }));
}

export async function createWebhookEndpoint(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    url: string;
    description?: string;
    enabledEvents?: string[];
  },
): Promise<{ id: string; secret: string; url: string }> {
  // Remove existing endpoint with same URL (secret is only available on create)
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = existing.data.find((ep) => ep.url === opts.url);
  if (match) {
    await stripe.webhookEndpoints.del(match.id);
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url: opts.url,
    enabled_events: (opts.enabledEvents ??
      BETTER_STRIPE_WEBHOOK_EVENTS) as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
    description:
      opts.description ?? 'Created by better-stripe createWebhookEndpoint',
  });

  return {
    id: endpoint.id,
    secret: endpoint.secret!,
    url: endpoint.url,
  };
}
