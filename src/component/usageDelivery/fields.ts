import { defineTable } from "convex/server";
import { v } from "convex/values";
export const reason = v.union(
  v.literal("rate_limited"),
  v.literal("provider_unavailable"),
  v.literal("provider_outcome_unknown"),
  v.literal("provider_rejected"),
  v.literal("retry_exhausted"),
  v.literal("delivery_window_expired"),
  v.literal("scope_busy"),
  v.literal("administrative_hold"),
);
export { usageDeliveryOutcomeValidator as outcome } from "../../client/usage/deliveryProtocol.js";
export const deliveryFields = {
  historySequence: v.optional(v.number()),
  provider: v.optional(v.string()),
  workflowId: v.optional(v.string()),
  definitionVersion: v.optional(v.literal(1)),
  firstSendAt: v.optional(v.number()),
  leaseUntil: v.optional(v.number()),
  held: v.optional(v.boolean()),
  reason: v.optional(reason),
  receipt: v.optional(
    v.object({ identifier: v.string(), created: v.number() }),
  ),
};
export const locksTable = defineTable({
  key: v.string(),
  eventId: v.optional(v.id("usageEvents")),
  leaseUntil: v.number(),
  nextAttemptAt: v.number(),
}).index("by_key", ["key"]);

export const errorCode = v.union(
  v.literal("meter_event_customer_not_found"),
  v.literal("meter_event_no_customer_defined"),
  v.literal("meter_event_dimension_count_too_high"),
  v.literal("archived_meter"),
  v.literal("timestamp_too_far_in_past"),
  v.literal("timestamp_in_future"),
  v.literal("meter_event_value_not_found"),
  v.literal("meter_event_invalid_value"),
  v.literal("no_meter"),
);
export const errorFields = {
  scopeKey: v.string(),
  eventId: v.id("usageEvents"),
  providerEventId: v.string(),
  code: errorCode,
  observedAt: v.number(),
  dedupe: v.string(),
};
export const errorDoc = v.object({
  _id: v.id("usageDeliveryErrors"),
  _creationTime: v.number(),
  ...errorFields,
});
export const errorsTable = defineTable(errorFields)
  .index("by_dedupe", ["dedupe"])
  .index("by_event", ["eventId"]);
