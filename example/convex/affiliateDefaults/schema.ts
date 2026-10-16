import { defineTable } from "convex/server";
import { v } from "convex/values";
import { optionalCommissionTerm } from "../marketplace/commission";
export const affiliateDefaultsTables = {
  affiliateDefaults: defineTable({
    sellerId: v.optional(v.id("users")),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.union(v.number(), v.null()),
    affiliateFixedAmount: v.union(v.number(), v.null()),
    version: v.number(),
  }).index("by_seller", ["sellerId"]),
};
