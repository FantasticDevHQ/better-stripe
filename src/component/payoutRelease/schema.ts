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
  historical: v.optional(v.boolean()),
  operationKey: v.string(),
  expectedRevision: v.number(),
  currency: v.string(),
  amount: v.number(),
  destinationId: v.optional(v.string()),
  allocations: v.array(allocation),
  observations: v.array(observation),
  status: v.union(
    v.literal("reserved"),
    v.literal("submitted"),
    v.literal("paid"),
    v.literal("returned"),
    v.literal("canceled"),
    v.literal("rejected"),
  ),
  attemptedAt: v.optional(v.number()),
  stripePayoutId: v.optional(v.string()),
  returnTransactionId: v.optional(v.string()),
  feeRevision: v.optional(v.number()),
  debitTransactionId: v.optional(v.string()),
  debitFee: v.optional(v.number()),
  providerFee: v.optional(v.number()),
  rejection: v.optional(
    v.object({
      requestId: v.string(),
      code: v.union(
        v.literal("balance_insufficient"),
        v.literal("amount_too_small"),
      ),
    }),
  ),
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
  .index("by_debit_receipt", ["debitTransactionId"])
  .index("by_return_receipt", ["returnTransactionId"])
  .index("by_rejection_request", ["rejection.requestId"]);
export const sourcesTable = defineTable({
  ...scopeFields,
  stripeTransferId: v.string(),
  currency: v.string(),
  paidAmount: v.number(),
  reservedAmount: v.number(),
})
  .index("by_transfer", ["stripeTransferId"])
  .index("by_account", ["accountId"]);
export const identity = { ...scopeFields, operationKey: v.string() };

export const feeBalancesTable = defineTable({
  ...scopeFields,
  currency: v.string(),
  amount: v.number(),
  revision: v.number(),
}).index("by_account_currency", ["accountId", "currency"]);
