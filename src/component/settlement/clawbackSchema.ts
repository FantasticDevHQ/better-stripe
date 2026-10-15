import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Principal snapshots on the original charge axis, never incremental debits. */
export const commissionExposureValidator = v.object({
  kind: v.union(v.literal("refund"), v.literal("dispute")),
  chargeAmount: v.number(),
  principal: v.number(),
  finalized: v.boolean(),
  disputeState: v.optional(
    v.union(v.literal("open"), v.literal("lost"), v.literal("won")),
  ),
  disputeId: v.optional(v.string()),
  refundedPrincipal: v.optional(v.number()),
  refundId: v.optional(v.string()),
});

export const obligationFields = {
  stripeTransferId: v.optional(v.string()),
  sourceChargeId: v.string(),
  sourceInvoiceId: v.optional(v.string()),
  paymentIntentId: v.optional(v.string()),
  paymentId: v.optional(v.string()),
  storeAccountId: v.optional(v.string()),
  lastRefundId: v.optional(v.string()),
  affiliateAccountId: v.string(),
  currency: v.string(),
  chargeAmount: v.number(),
  originalCommission: v.number(),
  refundedPrincipal: v.number(),
  disputedPrincipal: v.number(),
  lostPrincipal: v.number(),
  finalizedAmount: v.number(),
  provisionalAmount: v.number(),
  /** Confirmed transfer reversal total; reservations are not receipts. */
  recoveredAmount: v.number(),
  /** Existing reversals may have no attributable refund/dispute receipt. */
  needsReconciliation: v.boolean(),
  accounted: v.optional(v.boolean()),
  legacyReceiptIds: v.optional(v.array(v.string())),
  legacyRestorationIds: v.optional(v.array(v.string())),
  operatorNote: v.optional(v.string()),
  earningId: v.optional(v.id("affiliateEarnings")),
  releasedCommission: v.optional(v.number()),
  offsetAmount: v.optional(v.number()),
  restoredAmount: v.optional(v.number()),
  reservedRecovery: v.optional(v.number()),
  reservedRestoration: v.optional(v.number()),
  debtAmount: v.optional(v.number()),
  creditAmount: v.optional(v.number()),
  debtStatus: v.optional(v.union(v.literal("open"), v.literal("settled"))),
  disputeState: v.optional(
    v.union(v.literal("open"), v.literal("lost"), v.literal("won")),
  ),
  disputeId: v.optional(v.string()),
  activeOperationId: v.optional(v.id("affiliateRecoveryOperations")),
  lastState: v.optional(v.string()),
  lastError: v.optional(v.string()),
  operationSequence: v.optional(v.number()),
};
export const affiliateObligationsTable = defineTable(obligationFields)
  .index("by_transfer", ["stripeTransferId"])
  .index("by_charge", ["sourceChargeId"])
  .index("by_affiliate_currency_debt", [
    "affiliateAccountId",
    "currency",
    "debtStatus",
  ])
  .index("by_affiliate_currency", ["affiliateAccountId", "currency"]);
export const affiliateReversalReceiptsTable = defineTable({
  stripeReversalId: v.string(),
  stripeTransferId: v.string(),
  operationId: v.string(),
  amount: v.number(),
})
  .index("by_receipt", ["stripeReversalId"])
  .index("by_transfer_operation", ["stripeTransferId", "operationId"])
  .index("by_transfer", ["stripeTransferId"]);
