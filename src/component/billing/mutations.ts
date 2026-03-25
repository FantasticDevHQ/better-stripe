import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import {
  checkoutSessionModeValidator,
  checkoutSessionStatusValidator,
  subscriptionStatusValidator,
} from './validators';

// =============================================================================
// SUBSCRIPTION MUTATIONS
// =============================================================================

export const upsertSubscription = mutation({
  args: {
    stripeSubscriptionId: v.string(),
    accountId: v.optional(v.string()),
    userId: v.string(),
    orgId: v.optional(v.string()),
    status: subscriptionStatusValidator,
    priceId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    currentPeriodStart: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.string()),
    cancelAtPeriodEnd: v.boolean(),
    canceledAt: v.optional(v.string()),
    isTrialing: v.boolean(),
    trialStart: v.optional(v.string()),
    trialEnd: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_stripe_subscription_id', (q) =>
        q.eq('stripeSubscriptionId', args.stripeSubscriptionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('subscriptions', args);
    }

    // Backfill orphaned invoices with userId/orgId from the subscription
    if (args.userId) {
      const orphanedInvoices = await ctx.db
        .query('invoices')
        .withIndex('by_subscription_id', (q) =>
          q.eq('subscriptionId', args.stripeSubscriptionId),
        )
        .collect();

      for (const invoice of orphanedInvoices) {
        if (!invoice.userId) {
          await ctx.db.patch(invoice._id, {
            userId: args.userId,
            orgId: args.orgId,
          });
        }
      }
    }

    return null;
  },
});

// =============================================================================
// CHECKOUT SESSION MUTATIONS
// =============================================================================

export const upsertCheckoutSession = mutation({
  args: {
    stripeSessionId: v.string(),
    userId: v.string(),
    orgId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    mode: checkoutSessionModeValidator,
    status: checkoutSessionStatusValidator,
    clientSecret: v.optional(v.string()),
    url: v.optional(v.string()),
    priceId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('checkoutSessions')
      .withIndex('by_stripe_session_id', (q) =>
        q.eq('stripeSessionId', args.stripeSessionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('checkoutSessions', args);
    }

    return null;
  },
});

// =============================================================================
// INVOICE MUTATIONS
// =============================================================================

export const upsertInvoice = mutation({
  args: {
    stripeInvoiceId: v.string(),
    userId: v.string(),
    orgId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    status: v.string(),
    currency: v.string(),
    amountDue: v.number(),
    amountPaid: v.number(),
    hostedInvoiceUrl: v.optional(v.string()),
    invoicePdf: v.optional(v.string()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('invoices')
      .withIndex('by_stripe_invoice_id', (q) =>
        q.eq('stripeInvoiceId', args.stripeInvoiceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('invoices', args);
    }

    return null;
  },
});
