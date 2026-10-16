import { defineTable } from "convex/server";
import { v } from "convex/values";
export const transferReferenceFields = {
  batchId: v.id("financialTransferBatches"),
  position: v.number(),
  transferId: v.id("transfers"),
  observationId: v.id("financialTransferObservations"),
  observationGeneration: v.number(),
  sourceFingerprint: v.string(),
  observedFingerprint: v.string(),
  ownershipFingerprint: v.string(),
};
export const transferReferenceDoc = v.object({
  ...transferReferenceFields,
  _id: v.id("financialTransferBatchReferences"),
  _creationTime: v.number(),
});
export const transferBatchReferencesTable = defineTable(transferReferenceFields)
  .index("by_batch_position", ["batchId", "position"])
  .index("by_batch_transfer", ["batchId", "transferId"]);
