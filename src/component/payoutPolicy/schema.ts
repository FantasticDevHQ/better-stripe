import { observation } from "../payoutRelease/observation.js";
import { defineTable } from "convex/server";
import { v } from "convex/values";
export const scopeFields = { accountId: v.string(), ownerKey: v.string() };
export const schedule = v.object({
  interval: v.union(
    v.literal("daily"),
    v.literal("weekly"),
    v.literal("monthly"),
    v.literal("manual"),
  ),
  weeklyDays: v.optional(v.array(v.string())),
  monthlyDays: v.optional(v.array(v.number())),
});
export const mode = v.union(v.literal("stripe_managed"), v.literal("custom"));
export const thresholds = v.array(
  v.object({ currency: v.string(), amount: v.number() }),
);
export const adoptionProof = v.object({
  observations: v.array(observation),
  claims: v.array(
    v.object({ operationKey: v.string(), fingerprint: v.string() }),
  ),
  oldestHeldAt: v.optional(v.number()),
});
export const prepareFields = {
  adoption: v.optional(adoptionProof),
  ...scopeFields,
  operationKey: v.string(),
  expectedRevision: v.number(),
  mode,
  thresholds,
  country: v.string(),
  observedSchedule: schedule,
  observedAt: v.optional(v.number()),
};
export const expiryBalance = v.object({
  currency: v.string(),
  available: v.number(),
  pending: v.number(),
});
export const holdingExpiry = v.object({
  deadline: v.number(),
  status: v.union(
    v.literal("unverified"),
    v.literal("balance_remaining"),
    v.literal("claims_unresolved"),
    v.literal("no_held_balance"),
  ),
  observedAt: v.optional(v.number()),
  balances: v.optional(v.array(expiryBalance)),
});
export const policyFields = {
  ...scopeFields,
  revision: v.number(),
  mode,
  thresholds,
  status: v.union(v.literal("changing"), v.literal("ready")),
  operationKey: v.string(),
  country: v.string(),
  previousSchedule: v.optional(schedule),
  holdDeadline: v.optional(v.number()),
  holdingExpiry: v.optional(holdingExpiry),
};
export const operationFields = {
  ...prepareFields,
  revision: v.number(),
  previousSchedule: schedule,
  targetSchedule: schedule,
  status: v.union(
    v.literal("pending"),
    v.literal("complete"),
    v.literal("canceled"),
  ),
  attempted: v.optional(v.boolean()),
};
export const policyDoc = v.object({
  ...policyFields,
  _id: v.id("payoutPolicies"),
  _creationTime: v.number(),
});
export const operationDoc = v.object({
  ...operationFields,
  _id: v.id("payoutPolicyOperations"),
  _creationTime: v.number(),
});
export const policiesTable = defineTable(policyFields)
  .index("by_account", ["accountId"])
  .index("by_deadline", ["holdDeadline"])
  .index("by_status", ["status"])
  .index("by_mode_status", ["mode", "status"]);
export const operationsTable = defineTable(operationFields).index(
  "by_operation",
  ["operationKey"],
);
