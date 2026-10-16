import { defineTable } from "convex/server";
import { v } from "convex/values";
export const stripeTables = {
  // E2E observability: every sync trigger / async hook invocation records a
  // row here so the webhook E2E test can assert the trigger system ran.
  triggerLog: defineTable({
    source: v.union(v.literal("trigger"), v.literal("hook")),
    kind: v.string(),
    stripeId: v.string(),
  }).index("by_kind", ["kind"]),
};
