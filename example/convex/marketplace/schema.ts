import { defineTable } from "convex/server";
import { v } from "convex/values";
import { commissionTerm } from "./commission";
export const marketplaceTables = {
  subscriptionCommissions: defineTable({
    stripeSubscriptionId: v.string(),
    affiliateCommissionTerm: commissionTerm,
    firstInvoiceId: v.string(),
    affiliateAccountId: v.optional(v.string()),
  }).index("by_subscription", ["stripeSubscriptionId"]),
};
