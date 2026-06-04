import type Stripe from "stripe";

import type { RunCtx } from "../helpers.js";

// =============================================================================
// Webhook endpoint management
// =============================================================================

/**
 * V1 Stripe event types the better-stripe webhook handler processes.
 * Use this when creating webhook endpoints to ensure all needed events are enabled.
 */
export const BETTER_STRIPE_WEBHOOK_EVENTS = [
  // Products & Prices
  "product.created",
  "product.updated",
  "price.created",
  "price.updated",
  // Subscriptions
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Checkout
  "checkout.session.completed",
  // Invoices
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  // Payments
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  // Payouts
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
] as const;

export type BetterStripeWebhookEvent =
  (typeof BETTER_STRIPE_WEBHOOK_EVENTS)[number];

/**
 * V2 Stripe event types for Connect account lifecycle.
 * These are thin events — the webhook handler fetches full data from the API.
 */
export const BETTER_STRIPE_V2_WEBHOOK_EVENTS = [
  "v2.core.account.updated",
  "v2.core.account.created",
  "v2.core.account[requirements].updated",
  "v2.core.account[identity].updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.customer].updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[defaults].updated",
  "v2.core.account_person.created",
  "v2.core.account_person.updated",
  "v2.core.account_link.returned",
] as const;

export type BetterStripeV2WebhookEvent =
  (typeof BETTER_STRIPE_V2_WEBHOOK_EVENTS)[number];

/**
 * All events (V1 + V2) that better-stripe processes.
 * Use with setupEventDestination() for complete webhook coverage.
 */
export const ALL_BETTER_STRIPE_EVENTS: readonly string[] = [
  ...BETTER_STRIPE_WEBHOOK_EVENTS,
  ...BETTER_STRIPE_V2_WEBHOOK_EVENTS,
];

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
      opts.description ?? "Created by better-stripe createWebhookEndpoint",
  });

  return {
    id: endpoint.id,
    secret: endpoint.secret!,
    url: endpoint.url,
  };
}

// =============================================================================
// V2 Event Destination management (supports both V1 and V2 events)
// =============================================================================

/**
 * Summary of a Stripe V2 event destination returned by
 * {@link listEventDestinations}.
 *
 * The field types are annotated explicitly (via the public `Stripe`
 * namespace) so the emitted declarations stay portable and don't reference
 * Stripe's internal V2 module path (TS2742).
 */
export interface EventDestinationSummary {
  id: string;
  url: string;
  status: Stripe.V2.Core.EventDestination["status"];
  enabledEvents: Stripe.V2.Core.EventDestination["enabled_events"];
  eventPayload: Stripe.V2.Core.EventDestination["event_payload"];
  name: Stripe.V2.Core.EventDestination["name"];
  description: Stripe.V2.Core.EventDestination["description"];
}

export async function listEventDestinations(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: { limit?: number },
): Promise<EventDestinationSummary[]> {
  const destinations = await stripe.v2.core.eventDestinations.list({
    limit: opts?.limit ?? 100,
    include: ["webhook_endpoint.url"],
  });
  return destinations.data.map((d) => ({
    id: d.id,
    url: d.webhook_endpoint?.url ?? "",
    status: d.status,
    enabledEvents: d.enabled_events,
    eventPayload: d.event_payload,
    name: d.name,
    description: d.description,
  }));
}

/**
 * Create or update a Stripe V2 event destination.
 *
 * Stripe requires separate destinations for snapshot (V1) and thin (V2) events
 * because V2 events are inherently thin. This function finds an existing
 * destination matching the URL and payload type, updates it if found, or
 * creates a new one.
 *
 * Defaults to a thin destination with V2 account events if no overrides given.
 */
export async function setupEventDestination(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    url: string;
    name?: string;
    description?: string;
    enabledEvents?: string[];
    /** 'snapshot' for V1 events, 'thin' for V2 events. Defaults to 'thin'. */
    eventPayload?: "snapshot" | "thin";
  },
): Promise<{
  id: string;
  secret: string;
  url: string;
  enabledEvents: string[];
  created: boolean;
}> {
  const payloadType = opts.eventPayload ?? "thin";
  const events =
    opts.enabledEvents ??
    (payloadType === "thin"
      ? [...BETTER_STRIPE_V2_WEBHOOK_EVENTS]
      : [...BETTER_STRIPE_WEBHOOK_EVENTS]);
  const name =
    opts.name ??
    (payloadType === "thin" ? "better-stripe-v2" : "better-stripe");
  const description =
    opts.description ??
    (payloadType === "thin"
      ? "better-stripe V2 Connect account events"
      : "better-stripe V1 payment events");

  // Check for an existing destination at the same URL with matching payload type
  const existing = await stripe.v2.core.eventDestinations.list({
    include: ["webhook_endpoint.url"],
  });
  const match = existing.data.find(
    (d) =>
      d.webhook_endpoint?.url === opts.url && d.event_payload === payloadType,
  );

  if (match) {
    const updated = await stripe.v2.core.eventDestinations.update(match.id, {
      name,
      description,
      enabled_events: events,
      include: ["webhook_endpoint.url"],
    });

    if (updated.status === "disabled") {
      await stripe.v2.core.eventDestinations.enable(match.id);
    }

    return {
      id: updated.id,
      secret: match.webhook_endpoint?.signing_secret ?? "",
      url: opts.url,
      enabledEvents: updated.enabled_events,
      created: false,
    };
  }

  // Create new event destination
  const destination = await stripe.v2.core.eventDestinations.create({
    name,
    description,
    type: "webhook_endpoint",
    event_payload: payloadType,
    enabled_events: events,
    events_from: payloadType === "thin" ? ["self", "other_accounts"] : ["self"],
    webhook_endpoint: { url: opts.url },
    include: ["webhook_endpoint.signing_secret", "webhook_endpoint.url"],
  });

  return {
    id: destination.id,
    secret: destination.webhook_endpoint?.signing_secret ?? "",
    url: opts.url,
    enabledEvents: destination.enabled_events,
    created: true,
  };
}
