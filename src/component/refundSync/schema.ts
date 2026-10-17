import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Observation claims only; refunds and payment aggregates remain in existing tables. */
export const claimsTable = defineTable({
  stripeRefundId: v.string(),
  requestedContext: v.string(),
  generation: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("unknown"),
  ),
  startedAt: v.number(),
  acceptedContext: v.optional(v.string()),
  acceptedGeneration: v.optional(v.number()),
  acceptedAt: v.optional(v.number()),
  acceptedFingerprint: v.optional(v.string()),
}).index("by_stripe_refund_id", ["stripeRefundId"]);
