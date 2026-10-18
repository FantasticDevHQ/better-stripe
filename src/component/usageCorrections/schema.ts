import { defineTable } from "convex/server";
import { v } from "convex/values";
export const state = v.union(
  v.literal("requested"),
  v.literal("provider_accepted"),
  v.literal("confirmed"),
  v.literal("held"),
  v.literal("unsupported"),
  v.literal("invoice_adjustment_required"),
);
export const fields = {
  stripeAccountId: v.optional(v.string()),
  customerAccount: v.optional(v.string()),
  observedAt: v.optional(v.number()),
  nativeCreditNoteStatus: v.optional(
    v.union(v.literal("issued"), v.literal("void")),
  ),
  resolution: v.optional(
    v.union(v.literal("event_cancellation"), v.literal("invoice_credit")),
  ),
  adjustmentJson: v.optional(v.string()),
  key: v.string(),
  scopeKey: v.string(),
  eventId: v.id("usageEvents"),
  correctionId: v.string(),
  inputJson: v.string(),
  recordJson: v.string(),
  subscriptionJson: v.string(),
  quantity: v.string(),
  scaledQuantity: v.string(),
  state,
  reason: v.string(),
  firstAttemptAt: v.number(),
  attemptedAt: v.optional(v.number()),
  leaseUntil: v.optional(v.number()),
  attempt: v.number(),
  nativeAdjustmentId: v.optional(v.string()),
  nativeStatus: v.optional(
    v.union(v.literal("pending"), v.literal("complete")),
  ),
  invoiceId: v.optional(v.string()),
  creditNoteId: v.optional(v.string()),
  refundId: v.optional(v.string()),
  cashConsequence: v.union(
    v.literal("none"),
    v.literal("operator_resolution_required"),
    v.literal("verified_external_adjustment"),
  ),
  restoredQuantity: v.string(),
  historyCount: v.number(),
};
export const operationDoc = v.object({
  _id: v.id("usageCorrections"),
  _creationTime: v.number(),
  ...fields,
});
export const operationsTable = defineTable(fields)
  .index("by_key", ["key"])
  .index("by_event", ["eventId"])
  .index("by_scope", ["scopeKey"])
  .index("by_scope_state", ["scopeKey", "state"])
  .index("by_realm_state", ["stripeAccountId", "state"])
  .index("by_payer_state", ["customerAccount", "state"]);
export const historyFields = {
  key: v.string(),
  scopeKey: v.string(),
  eventId: v.id("usageEvents"),
  sequence: v.number(),
  state,
  reason: v.string(),
  recordJson: v.string(),
  subscriptionJson: v.string(),
  evidenceJson: v.string(),
  occurredAt: v.optional(v.number()),
  at: v.number(),
};
export const historyDoc = v.object({
  _id: v.id("usageCorrectionHistory"),
  _creationTime: v.number(),
  ...historyFields,
});
export const historyTable = defineTable(historyFields)
  .index("by_event", ["eventId"])
  .index("by_scope_time", ["scopeKey", "at"])
  .index("by_scope_occurrence", ["scopeKey", "occurredAt"]);
export const claimsTable = defineTable({
  key: v.string(),
  operationKey: v.string(),
  proofJson: v.string(),
}).index("by_key", ["key"]);
