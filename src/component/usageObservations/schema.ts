import { defineTable } from "convex/server";
import { v } from "convex/values";
export const observationsTable = defineTable({
  key: v.string(),
  scopeKey: v.string(),
  sourceJson: v.string(),
  observationJson: v.string(),
  startedAt: v.number(),
}).index("by_key", ["key"]);

export const historyPhase = v.union(
  v.literal("started"),
  v.literal("accepted"),
  v.literal("rate_limited"),
  v.literal("unavailable"),
  v.literal("unknown"),
  v.literal("rejected"),
  v.literal("held"),
  v.literal("resumed"),
  v.literal("window_expired"),
  v.literal("retry_exhausted"),
);
export const historyFields = {
  scopeKey: v.string(),
  eventId: v.id("usageEvents"),
  sequence: v.number(),
  attempt: v.number(),
  phase: historyPhase,
  identity: v.string(),
  recordedAt: v.number(),
  created: v.optional(v.number()),
};
export const historyDoc = v.object({
  _id: v.id("usageDeliveryHistory"),
  _creationTime: v.number(),
  ...historyFields,
});
export const historyTable = defineTable(historyFields)
  .index("by_event_sequence", ["eventId", "sequence"])
  .index("by_event_identity", ["eventId", "identity"]);
