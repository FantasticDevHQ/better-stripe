import { defineTable } from "convex/server";
import { v } from "convex/values";
import { splitRecipientRoleValidator } from "../lib/fees.js";

export const sourceFields = {
  allocationId: v.id("settlementAllocations"),
  sourceChargeId: v.string(),
  producer: v.literal("settlement_allocation"),
  producerVersion: v.literal(1),
  fingerprint: v.string(),
  observedFingerprint: v.string(),
  ownershipFingerprint: v.string(),
  generation: v.number(),
  legCount: v.number(),
  indexedLegCount: v.number(),
  isOverflow: v.boolean(),
  isContradictory: v.boolean(),
};
export const sourceDoc = v.object({
  ...sourceFields,
  _id: v.id("financialSourceObservations"),
  _creationTime: v.number(),
});
export const sourceObservationsTable = defineTable(sourceFields).index(
  "by_allocation_id",
  ["allocationId"],
);
export const legFields = {
  allocationId: v.id("settlementAllocations"),
  sourceChargeId: v.string(),
  legIndex: v.number(),
  bucketKey: v.string(),
  role: splitRecipientRoleValidator,
  registrationId: v.optional(v.id("financialOwnership")),
  userId: v.optional(v.string()),
  orgId: v.optional(v.string()),
  ownershipStatus: v.union(
    v.literal("registered"),
    v.literal("unknown"),
    v.literal("ambiguous"),
    v.literal("contradictory"),
  ),
};
export const legDoc = v.object({
  ...legFields,
  _id: v.id("financialSourceLegs"),
  _creationTime: v.number(),
});
export const sourceLegsTable = defineTable(legFields)
  .index("by_allocation_id_and_leg_index", ["allocationId", "legIndex"])
  .index("by_bucket_key", ["bucketKey"])
  .index("by_owner", ["userId", "orgId"]);
export const observationGenerationsTable = defineTable({
  scopeKey: v.string(),
  generation: v.number(),
}).index("by_scope_key", ["scopeKey"]);
