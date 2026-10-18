import { defineTable } from "convex/server";
import { v } from "convex/values";

export const journalFields = {
  accountId: v.string(),
  revision: v.number(),
  riskRevision: v.number(),
  financialRiskRevision: v.number(),
  financialPresent: v.boolean(),
  fenceStream: v.boolean(),
  kind: v.union(v.literal("baseline"), v.literal("bump")),
  legacyFinancialId: v.optional(v.id("payoutFinancialRevisions")),
  legacyRiskId: v.optional(v.id("payoutRiskRevisions")),
};
export const journalTable = defineTable(journalFields)
  .index("by_account_revision", ["accountId", "revision"])
  .index("by_account_fence_revision", ["accountId", "fenceStream", "revision"]);

export const activationResult = v.object({
  accountId: v.string(),
  status: v.union(
    v.literal("activated"),
    v.literal("unchanged"),
    v.literal("held"),
  ),
  reason: v.optional(
    v.union(
      v.literal("legacy_ambiguous"),
      v.literal("legacy_invalid"),
      v.literal("legacy_disagreement"),
      v.literal("representation_unavailable"),
    ),
  ),
});
