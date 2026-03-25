import { BetterStripe } from '@getdojo/better-stripe';

import { components } from './_generated/api';
import { internal } from './_generated/api';

export const stripe = new BetterStripe(components.betterStripe, {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,

  triggers: {
    subscription: {
      onCreate: async (ctx, doc) => {
        // Grant course access to the learner when they subscribe
        const courses = await ctx.runQuery(internal.courses.listPublished, {});
        for (const course of courses) {
          await ctx.runMutation(internal.courses.grantAccess, {
            userId: doc.userId,
            courseId: course._id,
          });
        }
        await ctx.runMutation(internal.webhookLog.insert, {
          eventType: 'subscription.created',
          stripeEventId: doc.stripeSubscriptionId,
          status: 'processed',
          payload: JSON.stringify({ userId: doc.userId }),
        });
      },
      onDelete: async (ctx, doc) => {
        // Revoke all course access when subscription is deleted
        await ctx.runMutation(internal.courses.revokeAllAccess, {
          userId: doc.userId,
        });
        await ctx.runMutation(internal.webhookLog.insert, {
          eventType: 'subscription.deleted',
          stripeEventId: doc.stripeSubscriptionId,
          status: 'processed',
          payload: JSON.stringify({ userId: doc.userId }),
        });
      },
    },
    checkoutSession: {
      onCompleted: async (ctx, doc) => {
        await ctx.runMutation(internal.webhookLog.insert, {
          eventType: 'checkout.session.completed',
          stripeEventId: doc.stripeSessionId,
          status: 'processed',
          payload: JSON.stringify({
            userId: doc.userId,
            mode: doc.mode,
          }),
        });
      },
    },
  },

  hooks: {
    onPayoutCompleted: async (ctx, doc) => {
      await ctx.runMutation(internal.webhookLog.insert, {
        eventType: 'payout.completed',
        stripeEventId: doc.stripePayoutId,
        status: 'processed',
        payload: JSON.stringify({ amount: doc.amount }),
      });
    },
    onInvoicePaid: async (ctx, doc) => {
      await ctx.runMutation(internal.webhookLog.insert, {
        eventType: 'invoice.paid',
        stripeEventId: doc.stripeInvoiceId,
        status: 'processed',
        payload: JSON.stringify({
          userId: doc.userId,
          amountPaid: doc.amountPaid,
        }),
      });
    },
    onPaymentFailed: async (ctx, doc) => {
      await ctx.runMutation(internal.webhookLog.insert, {
        eventType: 'payment.failed',
        stripeEventId: doc.stripePaymentIntentId,
        status: 'failed',
        payload: JSON.stringify({
          userId: doc.userId,
          amount: doc.amount,
        }),
      });
    },
    onTrialEnding: async (ctx, doc) => {
      await ctx.runMutation(internal.webhookLog.insert, {
        eventType: 'trial.ending',
        stripeEventId: doc.stripeSubscriptionId,
        status: 'processed',
        payload: JSON.stringify({
          userId: doc.userId,
          trialEnd: doc.trialEnd,
        }),
      });
    },
  },
});

// Export trigger API for use in http.ts
export const {
  onCheckoutSessionCompleted,
  onSubscriptionCreated,
  onSubscriptionUpdated,
  onSubscriptionDeleted,
} = stripe.triggersApi();
