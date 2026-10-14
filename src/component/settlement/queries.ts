import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { allocationFields, commissionFields } from "./schema.js";
const doc = v.object({
  ...allocationFields,
  _id: v.id("settlementAllocations"),
  _creationTime: v.number(),
});
export const getSettlementAllocation = query({
  args: { sourceChargeId: v.string() },
  returns: v.union(doc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("settlementAllocations")
      .withIndex("by_source_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .first(),
});
export const getCommissionTerm = query({
  args: { subscriptionId: v.string() },
  returns: v.union(v.object(commissionFields), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("commissionTerms")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .first();
    if (!row) return null;
    return {
      subscriptionId: row.subscriptionId,
      term: row.term,
      affiliateAccountId: row.affiliateAccountId,
      firstPaidInvoiceId: row.firstPaidInvoiceId,
    };
  },
});
