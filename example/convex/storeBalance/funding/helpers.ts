import { v } from "convex/values";

export const fields = {
  sellerId: v.id("users"),
  subscriptionId: v.string(),
  enabled: v.boolean(),
  paymentMethodId: v.string(),
  previousPaymentMethodId: v.optional(v.string()),
  previousPaymentMethodTypes: v.optional(v.array(v.string())),
  consentAt: v.number(),
  operationVersion: v.optional(v.number()),
  operationPending: v.optional(v.boolean()),
  targetEnabled: v.optional(v.boolean()),
};

export const doc = v.object({
  ...fields,
  _id: v.id("storeBalanceFunding"),
  _creationTime: v.number(),
});
