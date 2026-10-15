import { defineTable } from "convex/server";
import { v } from "convex/values";
export const recoveryState = v.union(
  v.literal("pending"),
  v.literal("unknown"),
  v.literal("insufficient_balance"),
  v.literal("unsupported"),
  v.literal("failed"),
  v.literal("succeeded"),
  v.literal("canceled"),
);
export const operationFields = {
  obligationId: v.id("affiliateObligations"),
  sourceEventId: v.optional(v.string()),
  kind: v.union(v.literal("recovery"), v.literal("restoration")),
  amount: v.number(),
  state: recoveryState,
  receiptId: v.optional(v.string()),
  error: v.optional(v.string()),
  attempted: v.boolean(),
  providerBaseline: v.optional(v.number()),
  createdAt: v.number(),
};
export const operationsTable = defineTable(operationFields)
  .index("by_obligation", ["obligationId"])
  .index("by_state", ["state"]);
export const earningFields = {
  sourceChargeId: v.string(),
  affiliateAccountId: v.string(),
  currency: v.string(),
  originalCommission: v.number(),
  withheldAmount: v.number(),
  releaseAmount: v.number(),
  sourceInvoiceId: v.optional(v.string()),
  paymentIntentId: v.optional(v.string()),
  stripeTransferId: v.optional(v.string()),
  status: v.union(v.literal("reserved"), v.literal("paid")),
};
export const earningsTable = defineTable(earningFields)
  .index("by_charge_affiliate", ["sourceChargeId", "affiliateAccountId"])
  .index("by_affiliate_currency", ["affiliateAccountId", "currency"]);
export const offsetsTable = defineTable({
  earningId: v.id("affiliateEarnings"),
  obligationId: v.id("affiliateObligations"),
  amount: v.number(),
})
  .index("by_earning", ["earningId"])
  .index("by_obligation", ["obligationId"]);
export const balanceFields = {
  activePayoutKey: v.optional(v.string()),
  pendingPayoutAmount: v.optional(v.number()),
  affiliateAccountId: v.string(),
  currency: v.string(),
  originalCommission: v.number(),
  recoveredAmount: v.number(),
  offsetAmount: v.number(),
  restoredAmount: v.number(),
  outstandingDebt: v.number(),
  reservedRecovery: v.number(),
  reservedRestoration: v.number(),
  restorationDue: v.number(),
  withheldAmount: v.number(),
  netPayable: v.number(),
};
export const balancesTable = defineTable(balanceFields).index(
  "by_affiliate_currency",
  ["affiliateAccountId", "currency"],
);
export const payoutReleaseFields = {
  affiliateAccountId: v.string(),
  currency: v.string(),
  operationKey: v.string(),
  amount: v.number(),
  minimumAmount: v.number(),
  state: v.union(
    v.literal("pending"),
    v.literal("unknown"),
    v.literal("submitted"),
    v.literal("failed"),
  ),
  stripePayoutId: v.optional(v.string()),
  createdAt: v.number(),
};
export const payoutReleasesTable = defineTable(payoutReleaseFields)
  .index("by_key", ["operationKey"])
  .index("by_state", ["state"]);
