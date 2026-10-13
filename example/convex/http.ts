import { env } from "./_generated/server";
import { registerRoutes } from "@fantastic.dev/better-stripe";
import { httpRouter } from "convex/server";

import { components, internal } from "./_generated/api";

const http = httpRouter();

registerRoutes(http, components.betterStripe, {
  webhookPath: "/stripe/webhook",
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  webhookSecretV2: env.STRIPE_WEBHOOK_SECRET_V2,
  webhooks: internal.stripe,
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
      await ctx.runAction(internal.storeBillingEvents.process, {
        type: event.type,
        objectId: event.data.object.id,
      });
    }
  },
});

export default http;
