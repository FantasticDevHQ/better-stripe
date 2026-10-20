import { usageInvoiceLineProof } from "../../shared/usageInvoiceLines.js";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { splitRecipientRoleValidator } from "../lib/fees.js";
export const termValidator = v.union(
  v.literal("forever"),
  v.literal("one_time"),
);
export const allocationFields = {
  policyContext: v.optional(
    v.object({
      namespace: v.string(),
      version: v.literal(1),
      fields: v.record(v.string(), v.string()),
    }),
  ),
  sourceChargeId: v.string(),
  paymentIntentId: v.optional(v.string()),
  sourceInvoiceId: v.optional(v.string()),
  usageSource: v.optional(
    v.object({
      invoiceLines: v.optional(v.array(usageInvoiceLineProof)),
      stripeAccountId: v.string(),
      customerAccount: v.string(),
      livemode: v.boolean(),
      meterId: v.string(),
      stripePriceId: v.string(),
      stripeProductId: v.string(),
      subscriptionId: v.string(),
      subscriptionItemId: v.string(),
      invoicePaymentId: v.string(),
      period: v.object({ start: v.number(), end: v.number() }),
      model: v.union(v.literal("pay_as_you_go"), v.literal("included_overage")),
    }),
  ),
  creditSource: v.optional(
    v.object({
      stripeAccountId: v.string(),
      customerAccount: v.string(),
      livemode: v.boolean(),
      purchaseId: v.string(),
      creditGrantId: v.string(),
      stripePriceId: v.string(),
      stripeProductId: v.string(),
    }),
  ),
  gross: v.number(),
  currency: v.string(),
  processingFee: v.number(),
  platformNet: v.number(),
  adjustmentAmount: v.optional(v.number()),
  paymentId: v.optional(v.string()),
  transfers: v.array(
    v.object({
      destinationAccountId: v.string(),
      role: splitRecipientRoleValidator,
      amount: v.number(),
    }),
  ),
};
export const allocationsTable = defineTable(allocationFields).index(
  "by_source_charge",
  ["sourceChargeId"],
);
export const commissionFields = {
  subscriptionId: v.string(),
  term: termValidator,
  affiliateAccountId: v.optional(v.string()),
  firstPaidInvoiceId: v.string(),
};
export const commissionTermsTable = defineTable(commissionFields).index(
  "by_subscription",
  ["subscriptionId"],
);
export const commissionDecisionsTable = defineTable({
  subscriptionId: v.string(),
  invoiceId: v.string(),
  eligible: v.boolean(),
  claimKey: v.string(),
}).index("by_subscription_invoice", ["subscriptionId", "invoiceId"]);
