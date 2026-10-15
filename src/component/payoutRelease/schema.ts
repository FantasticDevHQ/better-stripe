import { defineTable } from "convex/server";
import { v } from "convex/values";
import { scopeFields } from "../payoutPolicy/schema.js";
export const observation = v.object({
  stripeTransferId: v.string(),
  currency: v.string(),
  matureNet: v.number(),
  pendingCredits: v.number(),
  ledgerFingerprint: v.string(),
  observedAt: v.number(),
  transactionIds: v.array(v.string()),
});
export const allocation = v.object({
  stripeTransferId: v.string(),
  amount: v.number(),
  role: v.optional(
    v.union(v.literal("store"), v.literal("affiliate"), v.literal("other")),
  ),
});
export const claimFields = {
  ...scopeFields,
  operationKey: v.string(),
  expectedRevision: v.number(),
  currency: v.string(),
  amount: v.number(),
  allocations: v.array(allocation),
  observations: v.array(observation),
  status: v.union(
    v.literal("reserved"),
    v.literal("submitted"),
    v.literal("paid"),
    v.literal("returned"),
    v.literal("canceled"),
  ),
  attemptedAt: v.optional(v.number()),
  stripePayoutId: v.optional(v.string()),
  returnTransactionId: v.optional(v.string()),
};
export const claimDoc = v.object({
  ...claimFields,
  _id: v.id("payoutReleaseClaims"),
  _creationTime: v.number(),
});
export const claimsTable = defineTable(claimFields)
  .index("by_operation", ["operationKey"])
  .index("by_account_status", ["accountId", "status"])
  .index("by_provider_payout", ["stripePayoutId"])
  .index("by_return_receipt", ["returnTransactionId"]);
export const sourcesTable = defineTable({
  ...scopeFields,
  stripeTransferId: v.string(),
  currency: v.string(),
  paidAmount: v.number(),
  reservedAmount: v.number(),
}).index("by_transfer", ["stripeTransferId"]);
export const identity = { ...scopeFields, operationKey: v.string() };
