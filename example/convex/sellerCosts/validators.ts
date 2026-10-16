import { v } from "convex/values";
export const sellerCostFields = {
  sellerId: v.id("users"),
  sourceChargeId: v.string(),
  paymentIntentId: v.string(),
  currency: v.string(),
  amountDue: v.number(),
  collectedAmount: v.number(),
  invoicedAmount: v.number(),
  reservedAmount: v.optional(v.number()),
  outstanding: v.number(),
  open: v.boolean(),
  sourceType: v.optional(v.union(v.literal("refund"), v.literal("dispute"))),
  processingLoss: v.number(),
  disputeFees: v.number(),
  observedAt: v.number(),
  recoveryVersion: v.optional(v.number()),
  legacyObservedAt: v.optional(v.number()),
  sourceGross: v.optional(v.number()),
  sourceProcessingFee: v.optional(v.number()),
  invoiceRecoveryGroupKey: v.optional(v.string()),
};
export const sellerCostDoc = v.object({
  ...sellerCostFields,
  _id: v.id("sellerCosts"),
  _creationTime: v.number(),
});
export const costBillFields = {
  invoiceId: v.string(),
  sellerId: v.id("users"),
  currency: v.string(),
  amount: v.number(),
  allocations: v.array(
    v.object({ costId: v.id("sellerCosts"), amount: v.number() }),
  ),
  status: v.union(v.literal("pending"), v.literal("attached")),
  stripeInvoiceItemId: v.optional(v.string()),
};
export const costBillDoc = v.object({
  ...costBillFields,
  _id: v.id("storeCostBills"),
  _creationTime: v.number(),
});
