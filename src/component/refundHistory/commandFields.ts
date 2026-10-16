import { v } from "convex/values";

/** Correlation projection only; raw provider refund fields remain authoritative. */
export const refundCommandFields = {
  refundCommandNormalizationVersion: v.optional(v.literal(1)),
  refundCommandKey: v.optional(v.string()),
  refundCommandConflict: v.optional(v.boolean()),
  refundCommandObservedAt: v.optional(v.number()),
};
