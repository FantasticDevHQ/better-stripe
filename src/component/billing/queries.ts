import { v } from "convex/values";

import { query } from "../_generated/server";

// =============================================================================
// SUBSCRIPTION QUERIES
// =============================================================================

export const getSubscription = query({
  args: { subscriptionId: v.id("subscriptions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get("subscriptions", args.subscriptionId);
  },
});

export const getSubscriptionByStripeId = query({
  args: { stripeSubscriptionId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription_id", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();
  },
});

export const listSubscriptions = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let subsQuery;

    if (args.status) {
      subsQuery = ctx.db
        .query("subscriptions")
        .withIndex("by_status", (q) => q.eq("status", args.status as any));
    } else {
      subsQuery = ctx.db.query("subscriptions");
    }

    return await subsQuery.take(limit);
  },
});

export const listSubscriptionsByUser = query({
  args: {
    userId: v.string(),
    status: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // A user typically has a small number of subscriptions (current + historical).
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .collect();

    if (args.status) {
      return subs.filter((s) => s.status === args.status);
    }
    return subs;
  },
});

export const listSubscriptionsByOrg = query({
  args: {
    orgId: v.string(),
    status: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // An org typically has a small number of subscriptions (current + historical).
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
      .collect();

    if (args.status) {
      return subs.filter((s) => s.status === args.status);
    }
    return subs;
  },
});

export const getActiveSubscription = query({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Scoped to a single user/org — bounded by number of subscriptions per entity.
    const subs = args.orgId
      ? // eslint-disable-next-line @convex-dev/no-collect-in-query
        await ctx.db
          .query("subscriptions")
          .withIndex("by_org_id", (q) => q.eq("orgId", args.orgId))
          .collect()
      : // eslint-disable-next-line @convex-dev/no-collect-in-query
        await ctx.db
          .query("subscriptions")
          .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
          .collect();

    return (
      subs.find((s) => s.status === "active" || s.status === "trialing") ?? null
    );
  },
});

export const getTrialStatus = query({
  args: { subscriptionId: v.id("subscriptions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const sub = await ctx.db.get("subscriptions", args.subscriptionId);
    if (!sub) return null;

    let daysRemaining = 0;
    if (sub.isTrialing && sub.trialEnd) {
      const trialEndDate = new Date(sub.trialEnd);
      const now = new Date();
      daysRemaining = Math.max(
        0,
        Math.ceil(
          (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );
    }

    return {
      isTrialing: sub.isTrialing,
      trialStart: sub.trialStart,
      trialEnd: sub.trialEnd,
      daysRemaining,
      status: sub.status,
    };
  },
});

// =============================================================================
// CHECKOUT SESSION QUERIES
// =============================================================================

export const getCheckoutSession = query({
  args: { sessionId: v.id("checkoutSessions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get("checkoutSessions", args.sessionId);
  },
});

export const getCheckoutSessionByStripeId = query({
  args: { stripeSessionId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkoutSessions")
      .withIndex("by_stripe_session_id", (q) =>
        q.eq("stripeSessionId", args.stripeSessionId),
      )
      .first();
  },
});

export const listCheckoutSessionsByUser = query({
  args: {
    userId: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const sessions = await ctx.db
      .query("checkoutSessions")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .take(limit);

    if (args.status) {
      return sessions.filter((s) => s.status === args.status);
    }
    return sessions;
  },
});

// =============================================================================
// INVOICE QUERIES
// =============================================================================

export const getInvoiceByStripeId = query({
  args: { stripeInvoiceId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invoices")
      .withIndex("by_stripe_invoice_id", (q) =>
        q.eq("stripeInvoiceId", args.stripeInvoiceId),
      )
      .first();
  },
});

export const listInvoices = query({
  args: {
    userId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.userId) {
      const userId = args.userId;
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .take(limit);
      if (args.status) return invoices.filter((i) => i.status === args.status);
      return invoices;
    }

    if (args.subscriptionId) {
      const subscriptionId = args.subscriptionId;
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_subscription_id", (q) =>
          q.eq("subscriptionId", subscriptionId),
        )
        .take(limit);
      if (args.status) return invoices.filter((i) => i.status === args.status);
      return invoices;
    }

    const invoices = await ctx.db.query("invoices").take(limit);
    if (args.status) return invoices.filter((i) => i.status === args.status);
    return invoices;
  },
});
