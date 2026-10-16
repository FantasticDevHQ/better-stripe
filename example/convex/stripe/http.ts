import { registerRoutes } from "@fantastic.dev/better-stripe";
import { httpRouter } from "convex/server";
import { env } from "../_generated/server";

import { components, internal } from "../_generated/api";

export function registerStripeRoutes(http: ReturnType<typeof httpRouter>) {
  registerRoutes(http, components.betterStripe, {
    webhookPath: "/stripe/webhook",
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    webhookSecretV2: env.STRIPE_WEBHOOK_SECRET_V2,
    webhooks: internal.stripe.webhooks,
    retryOnHookError: (event) =>
      [
        "payment_intent.succeeded",
        "charge.updated",
        "invoice.paid",
        "invoice.created",
        "refund.created",
        "refund.updated",
        "refund.failed",
        "charge.dispute.created",
        "charge.dispute.updated",
        "charge.dispute.closed",
        "charge.dispute.funds_withdrawn",
        "charge.dispute.funds_reinstated",
        "invoice.payment_failed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type),
    onEvent: async (ctx, event) => {
      // Marketplace settlement reads platform charges; the component already handles connected-account events.
      if ("account" in event && event.account) return;
      if (
        "data" in event &&
        "id" in event.data.object &&
        [
          "payment_intent.succeeded",
          "charge.updated",
          "invoice.paid",
          "invoice.created",
          "refund.created",
          "refund.updated",
          "refund.failed",
          "charge.dispute.created",
          "charge.dispute.updated",
          "charge.dispute.closed",
          "charge.dispute.funds_withdrawn",
          "charge.dispute.funds_reinstated",
          "invoice.payment_failed",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ].includes(event.type)
      ) {
        await ctx.runAction(internal.billing.events.actions.process, {
          type: event.type,
          objectId: event.data.object.id,
        });
      }
    },
  });
}
