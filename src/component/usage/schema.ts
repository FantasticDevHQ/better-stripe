import { deliveryFields } from "../usageDelivery/fields.js";
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const scopeValidator = v.object({
  stripeAccountId: v.string(),
  customerAccount: v.string(),
  meterId: v.string(),
  livemode: v.boolean(),
});
export const deliveryValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("provider_accepted"),
  v.literal("rejected"),
  v.literal("unknown"),
  v.literal("held"),
);
export const eventFields = {
  subscriptionId: v.optional(v.string()),
  reservationId: v.optional(v.id("usageReservations")),
  scopeKey: v.string(),
  identity: v.string(),
  recordJson: v.string(),
  subscriptionJson: v.string(),
  occurredAt: v.number(),
  acceptedAt: v.number(),
};
export const eventDoc = v.object({
  _id: v.id("usageEvents"),
  _creationTime: v.number(),
  ...eventFields,
});
export const usageEventsTable = defineTable(eventFields)
  .index("by_identity", ["identity"])
  .index("by_scope_subscription", ["scopeKey", "subscriptionId"])
  .index("by_scope_subscription_time", [
    "scopeKey",
    "subscriptionId",
    "occurredAt",
  ])
  .index("by_scope_time", ["scopeKey", "occurredAt"]);
export const outboxFields = {
  ...deliveryFields,
  eventId: v.id("usageEvents"),
  scopeKey: v.string(),
  state: deliveryValidator,
  attempts: v.number(),
  nextAttemptAt: v.number(),
  providerIdentifier: v.string(),
  dispatch: v.optional(v.string()),
};
export const outboxDoc = v.object({
  _id: v.id("usageOutbox"),
  _creationTime: v.number(),
  ...outboxFields,
});
export const usageOutboxTable = defineTable(outboxFields)
  .index("by_provider_identifier", ["providerIdentifier"])
  .index("by_event", ["eventId"])
  .index("by_state_next", ["state", "nextAttemptAt"])
  .index("by_scope_state", ["scopeKey", "state"]);
export const usageScopeCountersTable = defineTable({
  scopeKey: v.string(),
  count: v.number(),
}).index("by_scope", ["scopeKey"]);
// Only accounting APIs may create reservations. There is no public arbitrary
// reservation/grant insertion API. Acceptance commits a matching reservation
// in the same transaction as its immutable event and outbox intent.
export const usageReservationsTable = defineTable({
  scopeKey: v.string(),
  sourceEventId: v.string(),
  planJson: v.string(),
  scaledQuantity: v.string(),
  state: v.union(
    v.literal("reserved"),
    v.literal("committed"),
    v.literal("released"),
  ),
  eventId: v.optional(v.id("usageEvents")),
  accountingKind: v.optional(
    v.union(v.literal("prepaid"), v.literal("allowance")),
  ),
  accountKey: v.optional(v.string()),
  inputJson: v.optional(v.string()),
  subscriptionJson: v.optional(v.string()),
  allocationsJson: v.optional(v.string()),
  releaseReason: v.optional(v.string()),
})
  .index("by_account_state", ["accountKey", "state"])
  .index("by_scope_source", ["scopeKey", "sourceEventId"])
  .index("by_scope_state", ["scopeKey", "state"]);
