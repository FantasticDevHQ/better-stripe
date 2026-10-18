import { defineTable } from "convex/server";
import { v } from "convex/values";
import { transferReversalOpFields } from "../connect/validators.js";
import { legFields } from "../financialObservations/schema.js";
export const payloadsTable = defineTable(transferReversalOpFields);
export const payloadDoc = v.object({
  ...transferReversalOpFields,
  _id: v.id("reversalObservationPayloads"),
  _creationTime: v.number(),
});
export const ref = v.object({
  transferId: v.id("transfers"),
  bucketDigest: v.string(),
  ownerDigest: v.optional(v.string()),
  identityFingerprint: v.string(),
  ambiguous: v.boolean(),
  markerId: v.optional(v.id("financialTransferObservations")),
  markerGeneration: v.optional(v.number()),
  markerIdentityFingerprint: v.optional(v.string()),
  ownershipFingerprint: v.optional(v.string()),
  registrationId: v.optional(v.id("financialOwnership")),
});
export const headerFields = {
  originalOperationId: v.id("transferReversalOps"),
  sourceCreatedAt: v.number(),
  producer: v.literal("reversal_claim_lifecycle"),
  producerVersion: v.literal(1),
  originalPayloadId: v.id("reversalObservationPayloads"),
  latestPayloadId: v.id("reversalObservationPayloads"),
  referenceFingerprints: v.array(v.string()),
  originalFingerprint: v.string(),
  latestIdentityFingerprint: v.string(),
  originalIdentityFingerprint: v.string(),
  fingerprint: v.string(),
  operationDigest: v.string(),
  sourceChargeDigest: v.string(),
  generation: v.number(),
  deleted: v.boolean(),
  sliceCount: v.number(),
  indexedCount: v.number(),
  nextIndex: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("validating"),
    v.literal("complete"),
    v.literal("held"),
  ),
  legacy: v.boolean(),
  isContradictory: v.boolean(),
  indexTransferGeneration: v.union(v.number(), v.null()),
};
export const headerDoc = v.object({
  ...headerFields,
  _id: v.id("reversalObservations"),
  _creationTime: v.number(),
});
export const observationsTable = defineTable(headerFields)
  .index("by_original_operation", ["originalOperationId"])
  .index("by_operation_digest", ["operationDigest"])
  .index("by_source_charge_digest", ["sourceChargeDigest"]);
export const refsTable = defineTable({
  observationId: v.id("reversalObservations"),
  chunkIndex: v.number(),
  refs: v.array(v.union(ref, v.null())),
}).index("by_observation_chunk", ["observationId", "chunkIndex"]);
export const sliceFields = {
  originalOperationId: v.id("transferReversalOps"),
  observationId: v.id("reversalObservations"),
  sliceIndex: v.number(),
  generation: v.number(),
  bucketDigest: v.optional(v.string()),
  ownerDigest: v.optional(v.string()),
  transferId: v.optional(v.id("transfers")),
  bucketKey: v.optional(v.string()),
  registrationId: legFields.registrationId,
  userId: legFields.userId,
  orgId: legFields.orgId,
  ownershipStatus: legFields.ownershipStatus,
  identityStatus: v.union(
    v.literal("matched"),
    v.literal("unknown"),
    v.literal("contradictory"),
  ),
  transferGeneration: v.union(v.number(), v.null()),
};
export const sliceDoc = v.object({
  ...sliceFields,
  _id: v.id("reversalObservationSlices"),
  _creationTime: v.number(),
});
export const slicesTable = defineTable(sliceFields)
  .index("by_observation_slice", ["observationId", "sliceIndex"])
  .index("by_bucket", ["bucketDigest"])
  .index("by_owner", ["ownerDigest"]);
export const operationResult = v.object({
  coverage: v.literal("unknown"),
  generation: v.union(v.number(), v.null()),
  transferGeneration: v.union(v.number(), v.null()),
  observation: v.union(headerDoc, v.null()),
});
