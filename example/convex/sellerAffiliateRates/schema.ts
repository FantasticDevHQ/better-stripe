import { defineTable } from "convex/server";
import { v } from "convex/values";
import { optionalCommissionTerm } from "../marketplace/commission";
export const sellerAffiliateRatesTables = {
  sellerAffiliateRates: defineTable({
    sellerId: v.id("users"),
    stripeProductId: v.string(),
    stripePriceId: v.optional(v.string()),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.union(v.number(), v.null()),
    affiliateFixedAmount: v.optional(v.union(v.number(), v.null())),
    version: v.number(),
  }).index("by_target", ["sellerId", "stripeProductId", "stripePriceId"]),
};
