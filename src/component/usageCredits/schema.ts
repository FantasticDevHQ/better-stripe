import { defineTable } from "convex/server";
import { v } from "convex/values";
export const accountFields = {
  key: v.string(),
  scopeKey: v.string(),
  bindingJson: v.string(),
  stripeAccountId: v.string(),
  customerAccount: v.string(),
  closed: v.boolean(),
  purchaseCount: v.number(),
  historyCount: v.number(),
  frozenReason: v.optional(v.string()),
};
export const accountsTable = defineTable(accountFields)
  .index("by_key", ["key"])
  .index("by_realm_closed", ["stripeAccountId", "closed"])
  .index("by_payer_closed", ["customerAccount", "closed"]);
export const purchaseFields = {
  key: v.string(),
  accountKey: v.string(),
  nativeCustomerKey: v.string(),
  capacityReserved: v.boolean(),
  paymentAttemptedAt: v.optional(v.number()),
  termsJson: v.string(),
  firstAttemptAt: v.number(),
  state: v.union(
    v.literal("pending"),
    v.literal("ready"),
    v.literal("frozen"),
    v.literal("canceled"),
  ),
  paymentIntentId: v.optional(v.string()),
  paymentKey: v.optional(v.string()),
  paymentProofJson: v.optional(v.string()),
  refundedAmount: v.optional(v.number()),
  grantFirstAttemptAt: v.optional(v.number()),
  creditGrantId: v.optional(v.string()),
};
export const purchaseDoc = v.object({
  _id: v.id("usageCreditPurchases"),
  _creationTime: v.number(),
  ...purchaseFields,
});
export const purchasesTable = defineTable(purchaseFields)
  .index("by_key", ["key"])
  .index("by_payment", ["paymentKey"])
  .index("by_customer_capacity", ["nativeCustomerKey", "capacityReserved"])
  .index("by_account", ["accountKey"]);
export const grantFields = {
  purchaseKey: v.string(),
  accountKey: v.string(),
  creditGrantId: v.string(),
  nativeCustomerKey: v.string(),
  nativeUnused: v.boolean(),
  nativeCreated: v.number(),
  paymentIntentId: v.string(),
  chargeId: v.string(),
  proofJson: v.string(),
  available: v.string(),
  reserved: v.string(),
  consumed: v.string(),
  effectiveAt: v.number(),
  expiresAt: v.union(v.number(), v.null()),
  frozen: v.boolean(),
  nativeExpired: v.optional(v.boolean()),
  nativeObservationJson: v.optional(v.string()),
  observedAt: v.optional(v.number()),
};
export const grantDoc = v.object({
  _id: v.id("usageCreditGrants"),
  _creationTime: v.number(),
  ...grantFields,
});
export const grantsTable = defineTable(grantFields)
  .index("by_purchase", ["purchaseKey"])
  .index("by_native", ["creditGrantId"])
  .index("by_customer_unused", ["nativeCustomerKey", "nativeUnused"])
  .index("by_account", ["accountKey"]);
export const historyFields = {
  accountKey: v.string(),
  purchaseKey: v.optional(v.string()),
  kind: v.union(
    v.literal("purchase"),
    v.literal("payment"),
    v.literal("grant"),
    v.literal("reservation"),
    v.literal("commit"),
    v.literal("release"),
    v.literal("observation"),
    v.literal("recovery"),
    v.literal("closure"),
  ),
  sourceKey: v.string(),
  fingerprint: v.string(),
  evidenceJson: v.string(),
  at: v.number(),
};
export const historyDoc = v.object({
  _id: v.id("usageCreditHistory"),
  _creationTime: v.number(),
  ...historyFields,
});
export const historyTable = defineTable(historyFields)
  .index("by_fingerprint", ["fingerprint"])
  .index("by_account", ["accountKey"])
  .index("by_purchase", ["accountKey", "purchaseKey"]);
