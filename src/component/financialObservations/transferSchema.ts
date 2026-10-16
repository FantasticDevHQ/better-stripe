import { defineTable } from "convex/server";
import { v } from "convex/values";
import { splitRecipientRoleValidator } from "../lib/fees.js";
import { legFields } from "./schema.js";
export const transferFields = {
  transferId: v.id("transfers"),
  stripeTransferId: v.string(),
  sourceChargeId: v.optional(v.string()),
  sourceInvoiceId: v.optional(v.string()),
  bucketKey: v.string(),
  role: v.optional(splitRecipientRoleValidator),
  registrationId: legFields.registrationId,
  userId: legFields.userId,
  orgId: legFields.orgId,
  ownershipStatus: legFields.ownershipStatus,
  producer: v.literal("transfer_fact"),
  producerVersion: v.literal(1),
  fingerprint: v.string(),
  observedFingerprint: v.string(),
  ownershipFingerprint: v.string(),
  generation: v.number(),
  isContradictory: v.boolean(),
};
export const transferObservationDoc = v.object({
  ...transferFields,
  _id: v.id("financialTransferObservations"),
  _creationTime: v.number(),
});
export const transferObservationsTable = defineTable(transferFields)
  .index("by_transfer_id", ["transferId"])
  .index("by_bucket_key", ["bucketKey"])
  .index("by_owner", ["userId", "orgId"]);
export const transferBatchFields = {
  originalOperationId: v.id("transferReversalOps"),
  operationId: v.string(),
  sourceChargeId: v.string(),
  producer: v.union(
    v.literal("transfer_frontier_release"),
    v.literal("transfer_frontier_claim"),
  ),
  producerVersion: v.literal(1),
  fingerprint: v.string(),
  generation: v.number(),
  observedFingerprint: v.string(),
  isContradictory: v.boolean(),
  referenceCount: v.number(),
  transferIds: v.array(v.id("transfers")),
  isOverflow: v.literal(true),
  state: v.literal("pending"),
};
export const transferBatchDoc = v.object({
  ...transferBatchFields,
  _id: v.id("financialTransferBatches"),
  _creationTime: v.number(),
});
export const transferBatchesTable = defineTable(transferBatchFields)
  .index("by_original_operation_id", ["originalOperationId"])
  .index("by_original_operation_producer", ["originalOperationId", "producer"])
  .index("by_operation_id", ["operationId"])
  .index("by_state", ["state"]);
