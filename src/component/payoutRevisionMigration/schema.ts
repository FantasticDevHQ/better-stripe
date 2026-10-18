import { defineTable } from "convex/server";
import { v } from "convex/values";
import { activationResult } from "../payoutRevisionJournal/schema.js";
export const inventoryTables = [
  "payoutFinancialRevisions",
  "payoutRiskRevisions",
  "transfers",
  "payouts",
  "recoveryBalances",
  "payoutSourceAllocations",
  "payoutReleaseClaims",
  "payoutFeeBalances",
] as const;
export const jobFields = {
  operationKey: v.string(),
  phase: v.number(),
  cursor: v.union(v.string(), v.null()),
  step: v.number(),
  status: v.union(v.literal("running"), v.literal("finished")),
  scanned: v.number(),
  visited: v.number(),
  activated: v.number(),
  unchanged: v.number(),
  held: v.number(),
};
export const jobDoc = v.object({
  ...jobFields,
  _id: v.id("payoutRevisionMigrations"),
  _creationTime: v.number(),
});
export const jobsTable = defineTable(jobFields).index("by_operation", [
  "operationKey",
]);
const { accountId: _accountId, ...outcome } = activationResult.fields;
export const resultFields = {
  jobId: v.id("payoutRevisionMigrations"),
  ...outcome,
  accountId: v.optional(v.string()),
  accountDigest: v.string(),
  sourceId: v.string(),
  sourceTable: v.string(),
};
export const resultDoc = v.object({
  ...resultFields,
  _id: v.id("payoutRevisionMigrationResults"),
  _creationTime: v.number(),
});
export const resultsTable = defineTable(resultFields).index("by_job_account", [
  "jobId",
  "accountDigest",
]);
