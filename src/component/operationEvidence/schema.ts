import { defineTable } from "convex/server";
import { v } from "convex/values";
import { transferReversalOpFields } from "../connect/validators.js";

// Deliberately EXACT source fields. Adding even small annotations can exceed 1 MiB.
export const payloadsTable = defineTable(transferReversalOpFields);
export const payloadDoc = v.object({
  ...transferReversalOpFields,
  _id: v.id("operationEvidencePayloads"),
  _creationTime: v.number(),
});
export const headerFields = {
  sourceId: v.id("transferReversalOps"),
  originalPayloadId: v.id("operationEvidencePayloads"),
  latestPayloadId: v.id("operationEvidencePayloads"),
  producer: v.literal("trusted_host_maintenance"),
  producerVersion: v.literal(1),
  firstObservedAt: v.number(),
  sourceCreatedAt: v.number(),
  originalFingerprint: v.string(),
  latestFingerprint: v.string(),
  originalIdentityFingerprint: v.string(),
  operationDigest: v.string(),
  sourceChargeDigest: v.string(),
  generation: v.number(),
  isContradictory: v.boolean(),
};
export const headerDoc = v.object({
  ...headerFields,
  _id: v.id("operationEvidenceHeaders"),
  _creationTime: v.number(),
});
export const headersTable = defineTable(headerFields)
  .index("by_source_id", ["sourceId"])
  .index("by_operation_digest", ["operationDigest"])
  .index("by_source_charge_digest", ["sourceChargeDigest"]);
export const readFields = {
  coverage: v.literal("unknown"),
  evidenceGeneration: v.union(v.number(), v.null()),
};
export const headerResult = v.object({
  ...readFields,
  header: v.union(headerDoc, v.null()),
});
export const payloadResult = v.object({
  ...headerResult.fields,
  payload: v.union(payloadDoc, v.null()),
});
export const captureResult = v.object({
  ...headerResult.fields,
  status: v.union(
    v.literal("captured"),
    v.literal("updated"),
    v.literal("unchanged"),
    v.literal("unavailable"),
    v.literal("source_unavailable"),
  ),
});
export const selectorValidator = v.union(
  v.literal("operationId"),
  v.literal("sourceChargeId"),
);
