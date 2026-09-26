import { httpActionGeneric } from "convex/server";
import type { HttpRouter } from "convex/server";

import type { Component } from "../helpers.js";
import type { RegisterRoutesConfig, WebhookActionCtx } from "../types.js";
import { handleWebhookRequest } from "./handler.js";

// Re-export sub-modules for direct access
export { handleWebhookRequest } from "./handler.js";
export { runHooks } from "./hooks.js";
export { processEvent } from "./processors.js";
export { handleV2Event, verifyV2Event } from "./v2.js";

// =============================================================================
// WEBHOOK REGISTRATION
// =============================================================================

/**
 * Register Stripe webhook HTTP route.
 * Standalone function following @convex-dev/stripe convention.
 *
 * Usage:
 * ```typescript
 * import { registerRoutes } from '@fantastic.dev/better-stripe';
 * registerRoutes(http, components.betterStripe, {
 *   webhookPath: '/stripe/webhook',
 *   stripeSecretKey: process.env.STRIPE_SECRET_KEY,
 *   webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
 * });
 * ```
 */
export function registerRoutes(
  http: HttpRouter,
  component: Component,
  config?: RegisterRoutesConfig,
) {
  const path = config?.webhookPath ?? "/stripe/webhook";

  http.route({
    path,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      return handleWebhookRequest(
        ctx as WebhookActionCtx,
        request,
        component,
        config,
      );
    }),
  });
}
