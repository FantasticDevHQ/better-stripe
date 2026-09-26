import { registerRoutes } from "@fantastic.dev/better-stripe";
import { httpRouter } from "convex/server";

import { components, internal } from "./_generated/api";

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: process.env.STRIPE_WEBHOOK_SECRET_V2,
  webhooks: internal.stripe,
});

export default http;
