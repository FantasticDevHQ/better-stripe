import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { obligationFields } from "./clawbackSchema.js";
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

/** Trusted host API: authorize account ownership before forwarding arguments. */
export const listAffiliateObligations = query({
  args: {
    affiliateAccountId: v.string(),
    currency: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      ...obligationFields,
      _id: v.id("affiliateObligations"),
      _creationTime: v.number(),
    }),
  ),
  handler: (ctx, args) =>
    paginator(ctx.db, schema)
      .query("affiliateObligations")
      .withIndex("by_affiliate_currency", (q) =>
        q
          .eq("affiliateAccountId", args.affiliateAccountId)
          .eq("currency", args.currency),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      }),
});
