import { defineTable } from "convex/server";
import { v } from "convex/values";
export const fields = {
  key: v.string(),
  nativeKey: v.string(),
  scopeKey: v.string(),
  bindingJson: v.string(),
  start: v.number(),
  end: v.number(),
  policyJson: v.string(),
  revision: v.number(),
  consumed: v.string(),
  reserved: v.string(),
  historyCount: v.number(),
};
export const policiesTable = defineTable(fields)
  .index("by_key", ["key"])
  .index("by_native_start", ["nativeKey", "start"])
  .index("by_scope_start", ["scopeKey", "start"]);
export const historyFields = {
  key: v.string(),
  kind: v.union(
    v.literal("policy"),
    v.literal("reservation"),
    v.literal("commit"),
    v.literal("release"),
  ),
  evidenceJson: v.string(),
  at: v.number(),
};
export const historyDoc = v.object({
  _id: v.id("usageAllowanceHistory"),
  _creationTime: v.number(),
  ...historyFields,
});
export const historyTable = defineTable(historyFields).index("by_key", ["key"]);
