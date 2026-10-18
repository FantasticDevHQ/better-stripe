import { defineTable } from "convex/server";
import { v } from "convex/values";
export const method = v.union(v.literal("direct"), v.literal("checkout"));
export const intentFields = {
  key: v.string(),
  scopeKey: v.string(),
  termsJson: v.string(),
  method,
  firstAttemptAt: v.number(),
  providerId: v.optional(v.string()),
  checkoutId: v.optional(v.string()),
  viewJson: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  controlKey: v.optional(v.string()),
  historyCount: v.optional(v.number()),
  retiredAt: v.optional(v.number()),
  abandonedId: v.optional(v.string()),
  retirementInvoiceId: v.optional(v.string()),
};
export const intentDoc = v.object({
  _id: v.id("usageSubscriptionIntents"),
  _creationTime: v.number(),
  ...intentFields,
});
export const intentsTable = defineTable(intentFields)
  .index("by_key", ["key"])
  .index("by_provider", ["providerId"]);
export const locksTable = defineTable({
  key: v.string(),
  intentKey: v.string(),
  stripeAccountId: v.string(),
  customerAccount: v.string(),
})
  .index("by_key", ["key"])
  .index("by_realm", ["stripeAccountId"])
  .index("by_payer", ["customerAccount"]);
export const historyFields = {
  intentKey: v.string(),
  kind: v.union(
    v.literal("subscription"),
    v.literal("invoice"),
    v.literal("retirement"),
  ),
  resourceId: v.string(),
  fingerprint: v.string(),
  observationJson: v.string(),
  startedAt: v.number(),
};
export const historyDoc = v.object({
  _id: v.id("usageSubscriptionHistory"),
  _creationTime: v.number(),
  ...historyFields,
});
export const historyTable = defineTable(historyFields)
  .index("by_fingerprint", ["fingerprint"])
  .index("by_intent_kind", ["intentKey", "kind"]);

export const controlFields = {
  key: v.string(),
  intentKey: v.string(),
  operationId: v.string(),
  cancelAtPeriodEnd: v.boolean(),
  firstAttemptAt: v.number(),
  resultJson: v.optional(v.string()),
};
export const controlDoc = v.object({
  _id: v.id("usageSubscriptionControls"),
  _creationTime: v.number(),
  ...controlFields,
});
export const controlsTable = defineTable(controlFields).index("by_key", [
  "key",
]);
