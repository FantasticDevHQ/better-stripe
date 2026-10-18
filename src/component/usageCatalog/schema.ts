import { defineTable } from "convex/server";
import { v } from "convex/values";
export const kind = v.union(v.literal("meter"), v.literal("price"));
export const fields = {
  observedAt: v.optional(v.number()),
  scopeKey: v.string(),
  kind,
  key: v.string(),
  termsJson: v.string(),
  firstAttemptAt: v.number(),
  providerId: v.optional(v.string()),
  observationJson: v.optional(v.string()),
};
export const doc = v.object({
  _id: v.id("usageCatalog"),
  _creationTime: v.number(),
  ...fields,
});
export const usageCatalogTable = defineTable(fields)
  .index("by_scope_kind_key", ["scopeKey", "kind", "key"])
  .index("by_scope_kind_provider", ["scopeKey", "kind", "providerId"]);
