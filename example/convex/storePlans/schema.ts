import { defineTable } from "convex/server";
import { v } from "convex/values";
import { optionalCommissionTerm } from "../marketplace/commission";
import { storePlanIdValidator } from "./validators";
export const storePlansTables = {
  storePlanSettings: defineTable({
    planId: storePlanIdValidator,
    monthlyAmount: v.number(),
    feeBasisPoints: v.union(v.number(), v.null()),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.optional(v.union(v.number(), v.null())),
    affiliateFixedAmount: v.optional(v.union(v.number(), v.null())),
    version: v.number(),
  }).index("by_plan", ["planId"]),

  storePlanCatalog: defineTable({
    planId: storePlanIdValidator,
    stripeProductId: v.string(),
    stripePriceId: v.string(),
  }).index("by_plan", ["planId"]),
};
