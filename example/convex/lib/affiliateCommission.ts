import { v } from "convex/values";
export const commissionTerm = v.union(
  v.literal("forever"),
  v.literal("one_time"),
);
export const optionalCommissionTerm = v.optional(
  v.union(commissionTerm, v.null()),
);
