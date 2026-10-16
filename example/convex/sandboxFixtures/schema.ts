import { defineTable } from "convex/server";
import { v } from "convex/values";
export const sandboxFixturesTables = {
  sandboxFixtureJobs: defineTable({
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
  }).index("by_version", ["version"]),

  sandboxFixtureResources: defineTable({
    key: v.string(),
    stripeId: v.string(),
    kind: v.string(),
  }).index("by_key", ["key"]),
};
