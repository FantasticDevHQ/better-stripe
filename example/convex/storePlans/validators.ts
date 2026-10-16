import { v } from "convex/values";
import { payoutSource } from "../affiliateDefaults/helpers";
import { commissionTerm } from "../marketplace/commission";
export const storePlanIdValidator = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("pro"),
);
export const storePlanRecordValidator = v.object({
  planId: storePlanIdValidator,
  stripeSubscriptionId: v.string(),
  status: v.string(),
  paidThrough: v.number(),
  cancelAtPeriodEnd: v.boolean(),
  lastInvoiceId: v.optional(v.string()),
});
export const storeSaleFields = {
  chargeId: v.string(),
  paymentIntentId: v.string(),
  sellerId: v.id("users"),
  sellerAccountId: v.string(),
  planId: storePlanIdValidator,
  gross: v.number(),
  processingFee: v.number(),
  sellingFee: v.number(),
  platformNet: v.number(),
  sellerNet: v.number(),
  affiliateCommissionTerm: v.optional(commissionTerm),
  stripeSubscriptionId: v.optional(v.string()),
  affiliateNet: v.number(),
  affiliateBasisPoints: v.optional(v.number()),
  affiliateFixedAmount: v.optional(v.number()),
  affiliateRateSource: v.optional(payoutSource),
  stripeProductId: v.optional(v.string()),
  stripePriceId: v.optional(v.string()),
  currency: v.string(),
  affiliateAccountId: v.optional(v.string()),
  sourceInvoiceId: v.optional(v.string()),
};
export const storeSaleRecordFields = {
  ...storeSaleFields,
  costRecoveryAmount: v.optional(v.number()),
  recoveryGroupKey: v.optional(v.string()),
  recoveryReady: v.optional(v.boolean()),
  settlementAttempted: v.optional(v.boolean()),
  status: v.union(
    v.literal("pending"),
    v.literal("settled"),
    v.literal("refunded"),
  ),
  sellerTransferId: v.optional(v.string()),
  affiliateTransferId: v.optional(v.string()),
};
export const storeSaleDocValidator = v.object({
  ...storeSaleRecordFields,
  _id: v.id("storeSales"),
  _creationTime: v.number(),
});
