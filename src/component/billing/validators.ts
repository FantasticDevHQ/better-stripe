import { type Infer, v } from "convex/values";

import { feeRoutingFields } from "../lib/fees";

export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("trialing"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
  v.literal("paused"),
);
export type SubscriptionStatus = Infer<typeof subscriptionStatusValidator>;

export const checkoutSessionModeValidator = v.union(
  v.literal("payment"),
  v.literal("subscription"),
  v.literal("setup"),
);
export type CheckoutSessionMode = Infer<typeof checkoutSessionModeValidator>;

export const checkoutSessionStatusValidator = v.union(
  v.literal("open"),
  v.literal("complete"),
  v.literal("expired"),
);
export type CheckoutSessionStatus = Infer<
  typeof checkoutSessionStatusValidator
>;

/**
 * Field validators for the `subscriptions` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const subscriptionFields = {
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
  currency: v.optional(v.string()),
  ...feeRoutingFields,
  metadata: v.optional(v.any()),
};

/** Full `subscriptions` document, including system fields. */
export const subscriptionDocValidator = v.object({
  _id: v.id("subscriptions"),
  _creationTime: v.number(),
  ...subscriptionFields,
});

/**
 * Field validators for the `checkoutSessions` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const checkoutSessionFields = {
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
};

/** Full `checkoutSessions` document, including system fields. */
export const checkoutSessionDocValidator = v.object({
  _id: v.id("checkoutSessions"),
  _creationTime: v.number(),
  ...checkoutSessionFields,
});

export const invoiceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("open"),
  v.literal("paid"),
  v.literal("uncollectible"),
  v.literal("void"),
);
export type InvoiceStatus = Infer<typeof invoiceStatusValidator>;

/**
 * Field validators for the `invoices` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const invoiceFields = {
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
  /**
   * Smart-retry dunning (BTS-33): when a subscription charge fails, Stripe's
   * automatic retries schedule the next attempt. `nextPaymentAttempt` is that
   * ISO timestamp (absent once the invoice is paid/void or retries are
   * exhausted); `attemptCount` is how many charge attempts Stripe has made.
   */
  nextPaymentAttempt: v.optional(v.string()),
  attemptCount: v.optional(v.number()),
  ...feeRoutingFields,
  metadata: v.optional(v.any()),
};

/** Full `invoices` document, including system fields. */
export const invoiceDocValidator = v.object({
  _id: v.id("invoices"),
  _creationTime: v.number(),
  ...invoiceFields,
});
