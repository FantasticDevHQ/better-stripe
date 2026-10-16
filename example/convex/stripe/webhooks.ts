import { stripe } from "./helpers";

// Export the webhook handler pair; http.ts passes their refs to registerRoutes
// via `webhooks: internal.stripe.webhooks`. `syncWebhook` runs the configured sync
// triggers in the same transaction as the component upsert; `asyncWebhook` runs
// the async hooks after commit.
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
