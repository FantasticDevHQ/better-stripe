import type { HttpRouter } from "convex/server";
import type { Component } from "./helpers.js";
import type { RegisterRoutesConfig } from "./types.js";
import { registerRoutes } from "./webhooks/index.js";
import { throwStripeError } from "./errors.js";
export function registerClientRoutes(
  client: { component: Component; apiKey: string; stripeApiVersion: string },
  http: HttpRouter,
  config?: RegisterRoutesConfig,
) {
  if (
    (config?.stripeApiVersion !== undefined &&
      config.stripeApiVersion !== client.stripeApiVersion) ||
    (config?.stripeSecretKey !== undefined &&
      config.stripeSecretKey !== client.apiKey)
  )
    throwStripeError(
      "INVALID_CONFIGURATION",
      "Webhook API version and secret key must match the BetterStripe client.",
    );
  registerRoutes(http, client.component, {
    ...config,
    stripeApiVersion: client.stripeApiVersion,
    stripeSecretKey: client.apiKey,
  });
}
