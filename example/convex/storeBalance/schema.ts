import { defineTable } from "convex/server";
import { v } from "convex/values";
export const storeBalanceTables = {
  storeBalanceFunding: defineTable({
    sellerId: v.id("users"),
    subscriptionId: v.string(),
    enabled: v.boolean(),
    paymentMethodId: v.string(),
    previousPaymentMethodId: v.optional(v.string()),
    previousPaymentMethodTypes: v.optional(v.array(v.string())),
    operationVersion: v.optional(v.number()),
    operationPending: v.optional(v.boolean()),
    targetEnabled: v.optional(v.boolean()),
    consentAt: v.number(),
  }).index("by_seller", ["sellerId"]),
};
