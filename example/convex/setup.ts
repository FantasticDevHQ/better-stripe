/**
 * Setup actions for the better-stripe example app.
 *
 * Called by the setup script: `npx convex run setup:ensureWebhook`
 */
import { v } from "convex/values";

import { action } from "./_generated/server";
import { stripe } from "./stripe";

/**
 * Ensure a Stripe webhook endpoint exists for this deployment.
 *
 * - Checks for an existing endpoint matching the site URL
 * - If found, replaces it (Stripe only returns the secret on create)
 * - If not found, creates a new one with all required events
 *
 * Returns the endpoint ID, URL, and signing secret.
 */
export const ensureWebhook = action({
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
