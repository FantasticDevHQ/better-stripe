import { defineTable } from "convex/server";
import { v } from "convex/values";
export const offerFields = {
  ownerId: v.id("users"),
  productId: v.string(),
  productName: v.string(),
  configurationJson: v.string(),
  baseAmount: v.number(),
  createdAt: v.number(),
  providerJson: v.optional(v.string()),
};
export const enrollmentFields = {
  returnOrigin: v.optional(v.string()),
  buyerId: v.id("users"),
  offerId: v.id("meteredProductOffers"),
  createdAt: v.number(),
  payerJson: v.optional(v.string()),
  checkoutJson: v.optional(v.string()),
  providerJson: v.optional(v.string()),
  initialInvoiceId: v.optional(v.string()),
  observedAt: v.optional(v.number()),
};
export const meteredProductTables = {
  meteredStoreSettings: defineTable({
    sellerId: v.id("users"),
    enabled: v.boolean(),
  }).index("by_seller", ["sellerId"]),
  meteredProductOffers: defineTable(offerFields)
    .index("by_product", ["productId"])
    .index("by_owner", ["ownerId"]),
  meteredProductEnrollments: defineTable(enrollmentFields).index(
    "by_buyer_offer",
    ["buyerId", "offerId"],
  ),
  coachingSessions: defineTable({
    enrollmentId: v.id("meteredProductEnrollments"),
    requestId: v.string(),
    quantity: v.string(),
    occurredAt: v.number(),
    receiptId: v.string(),
  }).index("by_enrollment_request", ["enrollmentId", "requestId"]),
  meteredProductPurchases: defineTable({
    createdAt: v.optional(v.number()),
    enrollmentId: v.id("meteredProductEnrollments"),
    requestId: v.string(),
    quantity: v.string(),
  })
    .index("by_enrollment_request", ["enrollmentId", "requestId"])
    .index("by_enrollment_created", ["enrollmentId", "createdAt"]),
};
export const offerDoc = v.object({
  _id: v.id("meteredProductOffers"),
  _creationTime: v.number(),
  ...offerFields,
});
export const enrollmentDoc = v.object({
  _id: v.id("meteredProductEnrollments"),
  _creationTime: v.number(),
  ...enrollmentFields,
});
export const enrollmentRef = {
  actorId: v.id("users"),
  enrollmentId: v.id("meteredProductEnrollments"),
};
