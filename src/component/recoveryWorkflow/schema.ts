import { defineTable } from "convex/server";
import { v } from "convex/values";
import { scopeFields } from "../costRecovery/schema.js";
import { allocationFields } from "../settlement/schema.js";
export const bindingFields = {
  ...scopeFields,
  groupKey: v.string(),
  provider: v.string(),
  completion: v.optional(v.string()),
  providerApiVersion: v.string(),
  definitionVersion: v.number(),
  releaseUncollectible: v.boolean(),
  maxAttempts: v.number(),
  retryDelayMs: v.number(),
  allocation: v.optional(v.object(allocationFields)),
};
export const startFields = { ...bindingFields, requestKey: v.string() };
export const refFields = {
  ...scopeFields,
  groupKey: v.string(),
  operationId: v.id("recoveryWorkflowOperations"),
  version: v.number(),
};
export const phase = v.union(v.literal("execute"), v.literal("reconcile"));
export const operationFields = {
  ...bindingFields,
  version: v.number(),
  sourceKind: v.union(v.literal("settlement"), v.literal("invoice")),
  sourceId: v.string(),
  workflowId: v.optional(v.string()),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("waiting"),
    v.literal("unknown"),
    v.literal("completed"),
    v.literal("canceled"),
  ),
  cancelRequested: v.boolean(),
  providerStarted: v.boolean(),
  activePhase: v.optional(phase),
  resumeQueued: v.boolean(),
  outcome: v.optional(v.union(v.literal("collect"), v.literal("release"))),
};
export const operationsTable = defineTable(operationFields)
  .index("by_group", ["groupKey"])
  .index("by_source", ["sourceKind", "sourceId"]);
export const requestsTable = defineTable({
  requestKey: v.string(),
  binding: v.object(bindingFields),
  operationId: v.id("recoveryWorkflowOperations"),
}).index("by_key", ["requestKey"]);
export const operationDoc = v.object({
  ...operationFields,
  _id: v.id("recoveryWorkflowOperations"),
  _creationTime: v.number(),
});
export const statusFields = {
  ...refFields,
  sourceKind: v.union(v.literal("settlement"), v.literal("invoice")),
  sourceId: v.string(),
  status: operationFields.status,
  cancelRequested: v.boolean(),
  outcome: operationFields.outcome,
};
export const safeStatus = v.object(statusFields);
export const conflict = v.object({
  status: v.literal("conflict"),
  reason: v.literal("identity_changed"),
  retryable: v.literal(false),
});
export const unavailable = v.object({
  status: v.literal("not_ready"),
  reason: v.literal("history_incomplete"),
  retryable: v.literal(true),
});
export const startResult = v.union(safeStatus, conflict, unavailable);
export const receipt = v.union(
  v.object({
    status: v.literal("ready"),
    outcome: v.union(v.literal("collect"), v.literal("release")),
  }),
  v.object({
    status: v.literal("not_ready"),
    reason: v.literal("provider_pending"),
  }),
  v.object({
    status: v.literal("unknown"),
    reason: v.literal("provider_outcome_unknown"),
  }),
  v.object({ status: v.literal("canceled") }),
);
