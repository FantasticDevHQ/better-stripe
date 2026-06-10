import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  checkoutSessionModeValidator,
  checkoutSessionStatusValidator,
  subscriptionStatusValidator,
} from "./validators";

/**
 * Subscriptions with first-class trial tracking.
 */
export const subscriptionsTable = defineTable({
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
})
  .index("by_stripe_subscription_id", ["stripeSubscriptionId"])
  .index("by_user_id", ["userId"])
  .index("by_org_id", ["orgId"])
  .index("by_status", ["status"])
  .index("by_account_id", ["accountId"]);

/**
 * Checkout sessions (embedded + redirect modes).
 */
export const checkoutSessionsTable = defineTable({
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
})
  .index("by_stripe_session_id", ["stripeSessionId"])
  .index("by_user_id", ["userId"])
  .index("by_account_id", ["accountId"]);

/**
 * Invoice summaries (line items fetched on demand from Stripe).
 */
export const invoicesTable = defineTable({
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
})
  .index("by_stripe_invoice_id", ["stripeInvoiceId"])
  .index("by_user_id", ["userId"])
  .index("by_subscription_id", ["subscriptionId"])
  .index("by_account_id", ["accountId"]);
