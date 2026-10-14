import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import {
  balanceFields,
  claimDoc,
  groupDoc,
  scopeFields,
  reservationDoc,
} from "./schema.js";
import {
  readBalance,
  scopeOnly,
  validateScope,
  batchLimit,
} from "./helpers.js";
export const balance = query({
  args: scopeFields,
  returns: v.object(balanceFields),
  handler: async (ctx, args) => {
    validateScope(args);
    const stored = await readBalance(ctx, args);
    return {
      ...scopeOnly(args),
      amountDue: stored?.amountDue ?? 0,
      collectedAmount: stored?.collectedAmount ?? 0,
      reservedAmount: stored?.reservedAmount ?? 0,
      outstanding: stored?.outstanding ?? 0,
      ...(stored?.activeGroupKey
        ? { activeGroupKey: stored.activeGroupKey }
        : {}),
    };
  },
});
export const listClaims = query({
  args: { ...scopeFields, paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(claimDoc),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateScope(args);
    batchLimit(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("recoveryClaims")
      .withIndex("by_scope", (q) =>
        q
          .eq("accountId", args.accountId)
          .eq("scopeKey", args.scopeKey)
          .eq("currency", args.currency),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
export const group = query({
  args: { groupKey: v.string() },
  returns: v.union(groupDoc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("recoveryGroups")
      .withIndex("by_key", (q) => q.eq("groupKey", args.groupKey))
      .unique(),
});
export const reservation = query({
  args: { operationKey: v.string() },
  returns: v.union(reservationDoc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("recoveryReservations")
      .withIndex("by_key", (q) => q.eq("operationKey", args.operationKey))
      .unique(),
});
export const claim = query({
  args: { claimKey: v.string() },
  returns: v.union(claimDoc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("recoveryClaims")
      .withIndex("by_key", (q) => q.eq("claimKey", args.claimKey))
      .unique(),
});
