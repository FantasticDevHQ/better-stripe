import { v } from "convex/values";

import { action, env } from "../../_generated/server";

import { stripe } from "../helpers";

// Webhook setup — creates both V1 (snapshot) and V2 (thin) event destinations
export const setupWebhooks = action({
  args: { siteUrl: v.string() },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;

    // 1. Ensure V1 snapshot destination exists (payments, subscriptions, etc.)
    const v1 = await stripe.setupEventDestination(ctx, {
      url: webhookUrl,
      eventPayload: "snapshot",
    });

    // 2. Ensure V2 thin destination exists (Connect account lifecycle)
    const v2 = await stripe.setupEventDestination(ctx, {
      url: webhookUrl,
      eventPayload: "thin",
    });

    return { v1, v2 };
  },
});

export const getWebhookStatus = action({
  args: { siteUrl: v.string() },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.siteUrl}/stripe/webhook`;
    const destinations = await stripe.listEventDestinations(ctx);

    const v1Match = destinations.find(
      (d) => d.url === webhookUrl && d.eventPayload === "snapshot",
    );
    const v2Match = destinations.find(
      (d) => d.url === webhookUrl && d.eventPayload === "thin",
    );

    return {
      v1: v1Match
        ? {
            id: v1Match.id,
            name: v1Match.name,
            status: v1Match.status,
            eventCount: v1Match.enabledEvents.length,
          }
        : null,
      v2: v2Match
        ? {
            id: v2Match.id,
            name: v2Match.name,
            status: v2Match.status,
            eventCount: v2Match.enabledEvents.length,
          }
        : null,
    };
  },
});

export const verifyWebhookEnvs = action({
  args: {},
  handler: async () => {
    return {
      v1: !!env.STRIPE_WEBHOOK_SECRET,
      v2: !!env.STRIPE_WEBHOOK_SECRET_V2,
    };
  },
});
