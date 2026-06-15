import { v } from "convex/values";

import { query } from "../_generated/server";
import {
  checkoutSessionDocValidator,
  checkoutSessionStatusValidator,
  invoiceDocValidator,
  invoiceStatusValidator,
  subscriptionDocValidator,
  subscriptionFields,
  subscriptionStatusValidator,
} from "./validators";

// =============================================================================
// SUBSCRIPTION QUERIES
// =============================================================================

export const getSubscription = query({
  args: { subscriptionId: v.id("subscriptions") },
  returns: v.union(subscriptionDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("subscriptions", args.subscriptionId);
  },
});

export const getSubscriptionByStripeId = query({
  args: { stripeSubscriptionId: v.string() },
  returns: v.union(subscriptionDocValidator, v.null()),
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
    accountId: v.optional(v.string()),
    status: v.optional(subscriptionStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(subscriptionDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId !== undefined && args.status !== undefined) {
      const { accountId, status } = args;
      return await ctx.db
        .query("subscriptions")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", accountId).eq("status", status),
        )
        .take(limit);
    }

    if (args.accountId !== undefined) {
      const accountId = args.accountId;
      return await ctx.db
        .query("subscriptions")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
    }

    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query("subscriptions")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }

    return await ctx.db.query("subscriptions").take(limit);
  },
});

export const listSubscriptionsByUser = query({
  args: {
    userId: v.string(),
    status: v.optional(v.string()),
  },
  returns: v.array(subscriptionDocValidator),
  handler: async (ctx, args) => {
    if (args.userId === "") return [];

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
  returns: v.array(subscriptionDocValidator),
  handler: async (ctx, args) => {
    if (args.orgId === "") return [];

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
  returns: v.union(subscriptionDocValidator, v.null()),
  handler: async (ctx, args) => {
    // Empty orgId is treated as absent.
    const orgId = args.orgId === "" ? undefined : args.orgId;
    if (args.userId === "" && orgId === undefined) return null;

    // Scoped to a single user/org — bounded by number of subscriptions per entity.
    const subs = orgId
      ? // eslint-disable-next-line @convex-dev/no-collect-in-query
        await ctx.db
          .query("subscriptions")
          .withIndex("by_org_id", (q) => q.eq("orgId", orgId))
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
  returns: v.union(
    v.object({
      isTrialing: v.boolean(),
      trialStart: subscriptionFields.trialStart,
      trialEnd: subscriptionFields.trialEnd,
      daysRemaining: v.number(),
      status: subscriptionStatusValidator,
    }),
    v.null(),
  ),
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
  returns: v.union(checkoutSessionDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("checkoutSessions", args.sessionId);
  },
});

export const getCheckoutSessionByStripeId = query({
  args: { stripeSessionId: v.string() },
  returns: v.union(checkoutSessionDocValidator, v.null()),
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
    status: v.optional(checkoutSessionStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(checkoutSessionDocValidator),
  handler: async (ctx, args) => {
    if (args.userId === "") return [];

    const limit = args.limit ?? 50;

    if (args.status !== undefined) {
      const { userId, status } = args;
      return await ctx.db
        .query("checkoutSessions")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", status),
        )
        .take(limit);
    }

    return await ctx.db
      .query("checkoutSessions")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .take(limit);
  },
});

// =============================================================================
// INVOICE QUERIES
// =============================================================================

export const getInvoiceByStripeId = query({
  args: { stripeInvoiceId: v.string() },
  returns: v.union(invoiceDocValidator, v.null()),
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
    accountId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    status: v.optional(invoiceStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(invoiceDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.accountId !== undefined) {
      const accountId = args.accountId;
      if (args.status !== undefined) {
        const status = args.status;
        return await ctx.db
          .query("invoices")
          .withIndex("by_account_status", (q) =>
            q.eq("accountId", accountId).eq("status", status),
          )
          .take(limit);
      }
      return await ctx.db
        .query("invoices")
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .take(limit);
    }

    if (args.userId !== undefined && args.userId !== "") {
      const userId = args.userId;
      if (args.status !== undefined) {
        const status = args.status;
        return await ctx.db
          .query("invoices")
          .withIndex("by_user_status", (q) =>
            q.eq("userId", userId).eq("status", status),
          )
          .take(limit);
      }
      return await ctx.db
        .query("invoices")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .take(limit);
    }

    if (args.subscriptionId !== undefined) {
      const subscriptionId = args.subscriptionId;
      if (args.status !== undefined) {
        const status = args.status;
        return await ctx.db
          .query("invoices")
          .withIndex("by_subscription_status", (q) =>
            q.eq("subscriptionId", subscriptionId).eq("status", status),
          )
          .take(limit);
      }
      return await ctx.db
        .query("invoices")
        .withIndex("by_subscription_id", (q) =>
          q.eq("subscriptionId", subscriptionId),
        )
        .take(limit);
    }

    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query("invoices")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }

    return await ctx.db.query("invoices").take(limit);
  },
});
