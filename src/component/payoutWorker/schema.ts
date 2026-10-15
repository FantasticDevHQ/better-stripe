import { defineTable } from "convex/server";
import { v } from "convex/values";
import { scopeFields } from "../payoutPolicy/schema.js";
export const scope = { ...scopeFields, currency: v.string() };
export const fields = {
  ...scope,
  generation: v.number(),
  sequence: v.number(),
  cadenceMs: v.number(),
  nextAttemptAt: v.number(),
  leaseUntil: v.optional(v.number()),
  operationKey: v.optional(v.string()),
  hasOperation: v.boolean(),
  lastReason: v.optional(v.string()),
  lastAttemptAt: v.optional(v.number()),
  completedGeneration: v.optional(v.number()),
  completedOperationKey: v.optional(v.string()),
};
export const jobDoc = v.object({
  ...fields,
  _id: v.id("payoutWorkerJobs"),
  _creationTime: v.number(),
});
export const jobsTable = defineTable(fields)
  .index("by_account_currency", ["accountId", "currency"])
  .index("by_operation_pending", ["hasOperation", "nextAttemptAt"]);
