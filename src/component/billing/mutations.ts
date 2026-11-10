import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { feeRoutingFields } from "../lib/fees";
import {
  checkoutSessionModeValidator,
  checkoutSessionStatusValidator,
  invoiceStatusValidator,
  subscriptionStatusValidator,
  upsertSubscriptionResultValidator,
} from "./validators";

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
    isCollectionPaused: v.optional(v.boolean()),
    canceledAt: v.optional(v.string()),
    isTrialing: v.boolean(),
    trialStart: v.optional(v.string()),
    trialEnd: v.optional(v.string()),
    currency: v.optional(v.string()),
    ...feeRoutingFields,
    metadata: v.optional(v.any()),
    /**
     * Stripe event `created` (epoch seconds) when the write comes from a
     * webhook. Omit for direct writes (API results, bulk sync): those always
     * apply and keep the stored watermark.
     */
    lastEventCreated: v.optional(v.number()),
  },
  returns: upsertSubscriptionResultValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription_id", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();

    if (existing) {
      const { lastEventCreated: incoming, ...fields } = args;
      const stored = existing.lastEventCreated;
      if (incoming !== undefined && stored !== undefined) {
        // Stripe does not order deliveries. An older event never overwrites a
        // newer one; within the same second the terminal state wins.
        const stale =
          incoming < stored ||
          (incoming === stored &&
            existing.status === "canceled" &&
            args.status !== "canceled");
        if (stale) {
          console.info(
            `[better-stripe] upsertSubscription: skipped stale event for ${args.stripeSubscriptionId} ` +
              `(event created ${incoming}, status ${args.status}; stored ${stored}, status ${existing.status})`,
          );
          return "stale" as const;
        }
      }
      // An undefined value in a patch REMOVES the field, so the watermark key
      // is only present when this write carries one.
      await ctx.db.patch(
        "subscriptions",
        existing._id,
        incoming === undefined
          ? fields
          : { ...fields, lastEventCreated: incoming },
      );
    } else {
      await ctx.db.insert("subscriptions", args);
    }

    // Backfill orphaned invoices with userId/orgId from the subscription
    if (args.userId) {
      // A single subscription has a bounded number of invoices (months/years of billing).
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      const orphanedInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_subscription_id", (q) =>
          q.eq("subscriptionId", args.stripeSubscriptionId),
        )
        .collect();

      for (const invoice of orphanedInvoices) {
        if (!invoice.userId) {
          await ctx.db.patch("invoices", invoice._id, {
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
    currency: v.optional(v.string()),
    ...feeRoutingFields,
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("checkoutSessions")
      .withIndex("by_stripe_session_id", (q) =>
        q.eq("stripeSessionId", args.stripeSessionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("checkoutSessions", existing._id, args);
    } else {
      await ctx.db.insert("checkoutSessions", args);
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
    status: invoiceStatusValidator,
    currency: v.string(),
    amountDue: v.number(),
    amountPaid: v.number(),
    hostedInvoiceUrl: v.optional(v.string()),
    invoicePdf: v.optional(v.string()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    nextPaymentAttempt: v.optional(v.string()),
    attemptCount: v.optional(v.number()),
    ...feeRoutingFields,
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_stripe_invoice_id", (q) =>
        q.eq("stripeInvoiceId", args.stripeInvoiceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch("invoices", existing._id, args);
    } else {
      await ctx.db.insert("invoices", args);
    }

    return null;
  },
});
