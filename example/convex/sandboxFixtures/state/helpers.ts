import { v } from "convex/values";

export const jobFields = {
  version: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  cursor: v.number(),
  total: v.number(),
  attempts: v.number(),
  updatedAt: v.number(),
  error: v.optional(v.string()),
};

export const jobDoc = v.object({
  ...jobFields,
  _id: v.id("sandboxFixtureJobs"),
  _creationTime: v.number(),
});
