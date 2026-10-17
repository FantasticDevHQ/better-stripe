import { v } from "convex/values";
export const operationRefFields = {
  accountId: v.string(),
  scopeKey: v.string(),
  currency: v.string(),
  operationId: v.string(),
  version: v.number(),
};
export const recoveryJobFields = {
  accountId: v.string(),
  scopeKey: v.string(),
  currency: v.string(),
  operationId: v.optional(v.string()),
  version: v.optional(v.number()),
  legacyVerified: v.optional(v.boolean()),
  blockedReason: v.optional(
    v.union(
      v.literal("legacy_mapping_required"),
      v.literal("legacy_inflight_unknown"),
      v.literal("settlement_pending"),
    ),
  ),
  requestKey: v.string(),
  sellerId: v.id("users"),
  kind: v.union(
    v.literal("cost"),
    v.literal("settlement"),
    v.literal("invoice"),
  ),
  sourceId: v.string(),
  paymentIntentId: v.optional(v.string()),
  observedAt: v.number(),
  legacyObservedAt: v.optional(v.number()),
  sourceType: v.optional(v.union(v.literal("refund"), v.literal("dispute"))),
  groupKey: v.optional(v.string()),
};
export const recoveryJobDoc = v.object({
  ...recoveryJobFields,
  _id: v.id("recoveryJobs"),
  _creationTime: v.number(),
});
export const costStartFields = {
  sellerId: v.id("users"),
  sourceChargeId: v.string(),
  paymentIntentId: v.string(),
  currency: v.string(),
  gross: v.number(),
  originalProcessingFee: v.number(),
  sellingFee: v.number(),
  customerAccountId: v.string(),
  sourceType: v.union(v.literal("refund"), v.literal("dispute")),
  stripePriceId: v.optional(v.string()),
  stripeProductId: v.optional(v.string()),
  invoiceId: v.optional(v.string()),
  invoiceRecoveryGroupKey: v.optional(v.string()),
};
