import { defineTable } from "convex/server";
import { v } from "convex/values";
export const financialRevisionsTable = defineTable({
  accountId: v.string(),
  revision: v.number(),
  riskRevision: v.number(),
}).index("by_account", ["accountId"]);
export const riskKind = v.union(
  v.literal("transfer"),
  v.literal("provider_payout"),
  v.literal("allocation"),
  v.literal("claim"),
  v.literal("fee"),
  v.literal("liability"),
);
export const riskEventsTable = defineTable({
  accountId: v.string(),
  riskRevision: v.number(),
  kind: riskKind,
  key: v.string(),
  removed: v.optional(v.boolean()),
}).index("by_account_revision", ["accountId", "riskRevision"]);
export const collectionPhase = v.union(
  v.literal("sources"),
  v.literal("allocations"),
  v.literal("fees"),
  v.literal("claims"),
  v.literal("repair"),
  v.literal("check"),
  v.literal("local_ready"),
  v.literal("invalidated"),
  v.literal("discarding"),
);
export const snapshotFields = {
  readOnly: v.boolean(),
  boundOperationKey: v.optional(v.string()),
  boundRiskRevision: v.optional(v.number()),
  accountId: v.string(),
  ownerKey: v.string(),
  operationKey: v.string(),
  expectedRevision: v.number(),
  policyMode: v.optional(v.string()),
  policyOperationKey: v.optional(v.string()),
  phase: collectionPhase,
  step: v.number(),
  sourceFence: v.number(),
  sourceCursor: v.optional(v.string()),
  allocationCursor: v.optional(v.string()),
  feeCursor: v.optional(v.string()),
  claimCursor: v.optional(v.string()),
  initialRevision: v.number(),
  initialRiskRevision: v.number(),
  riskRevision: v.number(),
  observedRevision: v.number(),
  sourceCount: v.number(),
  allocationCount: v.number(),
  claimCount: v.number(),
  feeCount: v.number(),
  deferredPositiveChanges: v.boolean(),
  providerChanged: v.boolean(),
  expiresAt: v.number(),
  reason: v.optional(v.string()),
};
export const snapshotDoc = v.object({
  ...snapshotFields,
  _id: v.id("payoutSnapshots"),
  _creationTime: v.number(),
});
export const snapshotsTable = defineTable(snapshotFields)
  .index("by_operation", ["operationKey"])
  .index("by_read_only", ["readOnly"])
  .index("by_account_phase", ["accountId", "phase"]);
export const snapshotSourcesTable = defineTable({
  snapshotId: v.id("payoutSnapshots"),
  stripeTransferId: v.string(),
  ledgerFingerprint: v.string(),
  transferDocId: v.optional(v.id("transfers")),
  allocationDocId: v.optional(v.id("payoutSourceAllocations")),
  sourceCreatedAt: v.number(),
  currency: v.string(),
  amount: v.number(),
  status: v.string(),
  role: v.optional(v.string()),
  sourceChargeId: v.optional(v.string()),
  reversedAmount: v.number(),
  reversalClaimedAmount: v.number(),
  reinstatement: v.boolean(),
  allocationPresent: v.boolean(),
  allocationCurrency: v.optional(v.string()),
  paidAmount: v.number(),
  reservedAmount: v.number(),
  expectedPaid: v.number(),
  expectedReserved: v.number(),
  needsCheck: v.boolean(),
})
  .index("by_snapshot", ["snapshotId"])
  .index("by_snapshot_transfer", ["snapshotId", "stripeTransferId"])
  .index("by_snapshot_check", ["snapshotId", "needsCheck"]);
export const snapshotClaimsTable = defineTable({
  snapshotId: v.id("payoutSnapshots"),
  operationKey: v.string(),
  fingerprint: v.string(),
  currency: v.string(),
  amount: v.number(),
  status: v.string(),
  stripePayoutId: v.optional(v.string()),
  historical: v.optional(v.boolean()),
  providerFee: v.optional(v.number()),
  allocations: v.array(
    v.object({
      stripeTransferId: v.string(),
      amount: v.number(),
      role: v.optional(v.string()),
    }),
  ),
})
  .index("by_snapshot", ["snapshotId"])
  .index("by_snapshot_operation", ["snapshotId", "operationKey"]);
export const snapshotFeesTable = defineTable({
  snapshotId: v.id("payoutSnapshots"),
  currency: v.string(),
  amount: v.number(),
  revision: v.number(),
})
  .index("by_snapshot", ["snapshotId"])
  .index("by_snapshot_currency", ["snapshotId", "currency"]);
export const riskRevisionsTable = defineTable({
  accountId: v.string(),
  riskRevision: v.number(),
}).index("by_account", ["accountId"]);
