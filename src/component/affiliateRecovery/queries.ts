import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { obligationFields } from "../settlement/clawbackSchema.js";
import { balanceFields, operationFields, earningFields } from "./schema.js";
export const obligationDoc = v.object({
  ...obligationFields,
  _id: v.id("affiliateObligations"),
  _creationTime: v.number(),
});
export const getObligation = query({
  args: { obligationId: v.id("affiliateObligations") },
  returns: v.union(obligationDoc, v.null()),
  handler: (ctx, args) => ctx.db.get("affiliateObligations", args.obligationId),
});
export const chargeObligations = query({
  args: { sourceChargeId: v.string() },
  returns: v.array(obligationDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("affiliateObligations")
      .withIndex("by_charge", (q) =>
        q.eq("sourceChargeId", args.sourceChargeId),
      )
      .take(1001);
    if (rows.length > 1000)
      throw new Error("Affiliate charge recovery limit exceeded.");
    return rows;
  },
});
export const getEarning = query({
  args: { sourceChargeId: v.string(), affiliateAccountId: v.string() },
  returns: v.union(
    v.object({
      ...earningFields,
      _id: v.id("affiliateEarnings"),
      _creationTime: v.number(),
    }),
    v.null(),
  ),
  handler: (ctx, args) =>
    ctx.db
      .query("affiliateEarnings")
      .withIndex("by_charge_affiliate", (q) =>
        q
          .eq("sourceChargeId", args.sourceChargeId)
          .eq("affiliateAccountId", args.affiliateAccountId),
      )
      .unique(),
});
export const recoverySnapshot = query({
  args: {
    affiliateAccountId: v.string(),
    currency: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    balance: v.union(
      v.object({
        ...balanceFields,
        _id: v.id("affiliateRecoveryBalances"),
        _creationTime: v.number(),
      }),
      v.null(),
    ),
    obligations: paginationResultValidator(obligationDoc),
  }),
  handler: async (ctx, args) => ({
    balance: await ctx.db
      .query("affiliateRecoveryBalances")
      .withIndex("by_affiliate_currency", (q) =>
        q
          .eq("affiliateAccountId", args.affiliateAccountId)
          .eq("currency", args.currency),
      )
      .unique(),
    obligations: await paginator(ctx.db, schema)
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
  }),
});
export const operationHistory = query({
  args: {
    obligationId: v.id("affiliateObligations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      ...operationFields,
      _id: v.id("affiliateRecoveryOperations"),
      _creationTime: v.number(),
    }),
  ),
  handler: (ctx, args) =>
    paginator(ctx.db, schema)
      .query("affiliateRecoveryOperations")
      .withIndex("by_obligation", (q) =>
        q.eq("obligationId", args.obligationId),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      }),
});
export const pendingOperations = query({
  args: {
    paginationOpts: paginationOptsValidator,
    state: v.union(v.literal("pending"), v.literal("unknown")),
  },
  returns: paginationResultValidator(
    v.object({
      ...operationFields,
      _id: v.id("affiliateRecoveryOperations"),
      _creationTime: v.number(),
    }),
  ),
  handler: (ctx, args) =>
    paginator(ctx.db, schema)
      .query("affiliateRecoveryOperations")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(50, args.paginationOpts.numItems),
      }),
});
