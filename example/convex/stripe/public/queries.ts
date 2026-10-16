import { v } from "convex/values";

import { query } from "../../_generated/server";

import { stripe } from "../helpers";

// Config
export const getPublishableKey = query({
  args: {},
  handler: async (ctx) => stripe.getPublishableKey(ctx),
});

export const getStripeMode = query({
  args: {},
  handler: async (ctx) => stripe.getStripeMode(ctx),
});

export const listWebhookEvents = query({
  args: {
    eventType: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    stripe.listWebhookEvents(ctx, {
      eventType: args.eventType,
      status: args.status,
    }),
});
