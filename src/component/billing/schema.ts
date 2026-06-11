import { defineTable } from "convex/server";

import {
  checkoutSessionFields,
  invoiceFields,
  subscriptionFields,
} from "./validators";

/**
 * Subscriptions with first-class trial tracking.
 */
export const subscriptionsTable = defineTable(subscriptionFields)
  .index("by_stripe_subscription_id", ["stripeSubscriptionId"])
  .index("by_user_id", ["userId"])
  .index("by_org_id", ["orgId"])
  .index("by_status", ["status"])
  .index("by_account_id", ["accountId"]);

/**
 * Checkout sessions (embedded + redirect modes).
 */
export const checkoutSessionsTable = defineTable(checkoutSessionFields)
  .index("by_stripe_session_id", ["stripeSessionId"])
  .index("by_user_id", ["userId"])
  .index("by_account_id", ["accountId"]);

/**
 * Invoice summaries (line items fetched on demand from Stripe).
 */
export const invoicesTable = defineTable(invoiceFields)
  .index("by_stripe_invoice_id", ["stripeInvoiceId"])
  .index("by_user_id", ["userId"])
  .index("by_subscription_id", ["subscriptionId"])
  .index("by_account_id", ["accountId"]);
