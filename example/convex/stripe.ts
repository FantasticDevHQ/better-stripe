import { BetterStripe } from "@getdojo/better-stripe";

import { components, internal } from "./_generated/api";

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,

  triggers: {
    subscription: {
      onCreate: async (ctx, doc) => {
        console.log(
          `[trigger] Subscription created: ${doc.stripeSubscriptionId} for user ${doc.userId}`,
        );
        await ctx.runMutation(internal.triggerLogger.record, {
          source: "trigger",
          kind: "subscription.onCreate",
          stripeId: doc.stripeSubscriptionId,
        });
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        console.log(
          `[trigger] Subscription updated: ${newDoc.stripeSubscriptionId} (${oldDoc.status} -> ${newDoc.status})`,
        );
        await ctx.runMutation(internal.triggerLogger.record, {
          source: "trigger",
          kind: "subscription.onUpdate",
          stripeId: newDoc.stripeSubscriptionId,
        });
      },
      onDelete: async (ctx, doc) => {
        console.log(
          `[trigger] Subscription deleted: ${doc.stripeSubscriptionId} for user ${doc.userId}`,
        );
        await ctx.runMutation(internal.triggerLogger.record, {
          source: "trigger",
          kind: "subscription.onDelete",
          stripeId: doc.stripeSubscriptionId,
        });
      },
    },
    checkoutSession: {
      onCompleted: async (ctx, doc) => {
        console.log(
          `[trigger] Checkout completed: ${doc.stripeSessionId} (${doc.mode})`,
        );
        await ctx.runMutation(internal.triggerLogger.record, {
          source: "trigger",
          kind: "checkoutSession.onCompleted",
          stripeId: doc.stripeSessionId,
        });
      },
    },
  },

  hooks: {
    onPayoutCompleted: async (ctx, doc) => {
      console.log(
        `[hook] Payout completed: ${doc.stripePayoutId} ($${doc.amount / 100})`,
      );
      await ctx.runMutation(internal.triggerLogger.record, {
        source: "hook",
        kind: "onPayoutCompleted",
        stripeId: doc.stripePayoutId,
      });
    },
    onInvoicePaid: async (ctx, doc) => {
      console.log(
        `[hook] Invoice paid: ${doc.stripeInvoiceId} ($${doc.amountPaid / 100})`,
      );
      await ctx.runMutation(internal.triggerLogger.record, {
        source: "hook",
        kind: "onInvoicePaid",
        stripeId: doc.stripeInvoiceId,
      });
    },
    onPaymentFailed: async (ctx, doc) => {
      console.log(
        `[hook] Payment failed: ${doc.stripePaymentIntentId} ($${doc.amount / 100})`,
      );
      await ctx.runMutation(internal.triggerLogger.record, {
        source: "hook",
        kind: "onPaymentFailed",
        stripeId: doc.stripePaymentIntentId,
      });
    },
    onTrialEnding: async (ctx, doc) => {
      console.log(
        `[hook] Trial ending: ${doc.stripeSubscriptionId} (ends ${doc.trialEnd})`,
      );
      await ctx.runMutation(internal.triggerLogger.record, {
        source: "hook",
        kind: "onTrialEnding",
        stripeId: doc.stripeSubscriptionId,
      });
    },
  },
});

// Export the webhook handler pair; http.ts passes their refs to registerRoutes
// via `webhooks: internal.stripe`. `syncWebhook` runs the configured sync
// triggers in the same transaction as the component upsert; `asyncWebhook` runs
// the async hooks after commit.
export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
