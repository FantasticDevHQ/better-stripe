import { defineTable } from "convex/server";
import { v } from "convex/values";
export const demoModel = v.union(
  v.literal("pay_as_you_go"),
  v.literal("included_overage"),
  v.literal("prepaid"),
);
export const demoRunFields = {
  actorId: v.id("users"),
  model: demoModel,
  configurationJson: v.string(),
  settlementPolicyJson: v.optional(v.string()),
  createdAt: v.number(),
  archived: v.boolean(),
  billingStartedAt: v.optional(v.number()),
  correctionActivityIds: v.optional(v.array(v.id("meteredDemoActivities"))),
  providerJson: v.optional(v.string()),
  billingJson: v.optional(v.string()),
  cleanupJson: v.optional(v.string()),
  lastActivityId: v.optional(v.id("meteredDemoActivities")),
  lastAcceptedActivityId: v.optional(v.id("meteredDemoActivities")),
  lastPurchaseId: v.optional(v.id("meteredDemoPurchases")),
};
export const demoResourceFields = {
  runId: v.id("meteredDemoRuns"),
  kind: v.string(),
  createdAt: v.number(),
  stripeId: v.optional(v.string()),
};
export const demoActivityFields = {
  runId: v.id("meteredDemoRuns"),
  requestId: v.string(),
  quantity: v.string(),
  occurredAt: v.number(),
  receiptId: v.optional(v.string()),
  completedAt: v.optional(v.number()),
};
export const demoPurchaseFields = {
  runId: v.id("meteredDemoRuns"),
  requestId: v.string(),
  quantity: v.string(),
  createdAt: v.number(),
};
/** Host fixture provenance and synthetic business work, never another usage ledger. */
export const meteredUsageTables = {
  meteredDemoPurchases: defineTable(demoPurchaseFields).index(
    "by_run_request",
    ["runId", "requestId"],
  ),
  meteredDemoRuns: defineTable(demoRunFields).index("by_actor_model", [
    "actorId",
    "model",
  ]),
  meteredDemoResources: defineTable(demoResourceFields).index("by_run_kind", [
    "runId",
    "kind",
  ]),
  meteredDemoActivities: defineTable(demoActivityFields).index(
    "by_run_request",
    ["runId", "requestId"],
  ),
};
