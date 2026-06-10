import { BetterStripe } from "@getdojo/better-stripe";

import { components } from "./_generated/api";

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,

  triggers: {
    subscription: {
      onCreate: async (_ctx, doc) => {
        console.log(
          `[trigger] Subscription created: ${doc.stripeSubscriptionId} for user ${doc.userId}`,
        );
      },
      onUpdate: async (_ctx, newDoc, oldDoc) => {
        console.log(
          `[trigger] Subscription updated: ${newDoc.stripeSubscriptionId} (${oldDoc.status} -> ${newDoc.status})`,
        );
      },
      onDelete: async (_ctx, doc) => {
        console.log(
          `[trigger] Subscription deleted: ${doc.stripeSubscriptionId} for user ${doc.userId}`,
        );
      },
    },
    checkoutSession: {
      onCompleted: async (_ctx, doc) => {
        console.log(
          `[trigger] Checkout completed: ${doc.stripeSessionId} (${doc.mode})`,
        );
      },
    },
  },

  hooks: {
    onPayoutCompleted: async (_ctx, doc) => {
      console.log(
        `[hook] Payout completed: ${doc.stripePayoutId} ($${doc.amount / 100})`,
      );
    },
    onInvoicePaid: async (_ctx, doc) => {
      console.log(
        `[hook] Invoice paid: ${doc.stripeInvoiceId} ($${doc.amountPaid / 100})`,
      );
    },
    onPaymentFailed: async (_ctx, doc) => {
      console.log(
        `[hook] Payment failed: ${doc.stripePaymentIntentId} ($${doc.amount / 100})`,
      );
    },
    onTrialEnding: async (_ctx, doc) => {
      console.log(
        `[hook] Trial ending: ${doc.stripeSubscriptionId} (ends ${doc.trialEnd})`,
      );
    },
  },
});

// Export trigger dispatchers + async hooks; http.ts passes their refs to registerRoutes
export const {
  accountUpserted,
  productUpserted,
  priceUpserted,
  subscriptionUpserted,
  subscriptionDeleted,
  checkoutSessionUpserted,
  invoiceUpserted,
  paymentUpserted,
  payoutUpserted,
  afterAccountUpdated,
  afterCheckoutCompleted,
  afterSubscriptionUpdated,
  afterSubscriptionCanceled,
  afterTrialEnding,
  afterInvoicePaid,
  afterPaymentSucceeded,
  afterPaymentFailed,
  afterPayoutCompleted,
} = stripe.triggersApi();
