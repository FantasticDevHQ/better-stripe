import { defineTable } from "convex/server";
import { v } from "convex/values";

export const ownerFields = {
  userId: v.string(),
  orgId: v.optional(v.string()),
};
export const sourceValidator = v.object({
  integration: v.string(),
  recordId: v.string(),
});
export const registrationFields = {
  bucketKey: v.string(),
  kind: v.union(v.literal("stripe_account"), v.literal("logical")),
  ...ownerFields,
  source: sourceValidator,
  generation: v.number(),
};
export const registrationDoc = v.object({
  ...registrationFields,
  _id: v.id("financialOwnership"),
  _creationTime: v.number(),
});
export const ownershipTable = defineTable(registrationFields)
  .index("by_bucket_key", ["bucketKey"])
  .index("by_owner", ["userId", "orgId"]);
export const generationsTable = defineTable({
  ...ownerFields,
  generation: v.number(),
}).index("by_owner", ["userId", "orgId"]);
export const registrationResult = v.object({
  status: v.literal("registered"),
  coverage: v.literal("unknown"),
  registration: registrationDoc,
});
