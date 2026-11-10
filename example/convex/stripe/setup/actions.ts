/**
 * Setup actions for the better-stripe example app.
 *
 * Internal only: `ensureWebhook` creates a Stripe webhook endpoint and
 * returns its signing secret, so it must never be callable from a client.
 * Nothing in the app or its scripts calls it today (the Admin Setup page uses
 * `stripe/public/actions:setupWebhooks`, which stores the secrets server-side
 * instead of returning them). Operators can still run it from a trusted shell:
 * `npx convex run stripe/setup/actions:ensureWebhook '{"siteUrl":"..."}'`
 */
import { v } from "convex/values";

import { internalAction } from "../../_generated/server";

import { stripe } from "../helpers";

/**
 * Ensure a Stripe webhook endpoint exists for this deployment.
 *
 * - Checks for an existing endpoint matching the site URL
 * - If found, replaces it (Stripe only returns the secret on create)
 * - If not found, creates a new one with all required events
 *
 * Returns the endpoint ID, URL, and signing secret.
 */
export const ensureWebhook = internalAction({
  args: {
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;

    // Check for existing endpoint at this URL
    const endpoints = await stripe.listWebhookEndpoints(ctx);
    const existing = endpoints.find((ep) => ep.url === webhookUrl);

    if (existing) {
      console.log(
        `[setup] Found existing webhook endpoint: ${existing.id} → ${existing.url}`,
      );
    }

    // Create (or replace) to get a fresh signing secret
    const result = await stripe.createWebhookEndpoint(ctx, {
      url: webhookUrl,
      description: "better-stripe example app (managed by setup script)",
    });

    console.log(
      `[setup] ${existing ? "Replaced" : "Created"} webhook endpoint: ${result.id} → ${result.url}`,
    );

    return {
      id: result.id,
      url: result.url,
      secret: result.secret,
      replaced: !!existing,
    };
  },
});
