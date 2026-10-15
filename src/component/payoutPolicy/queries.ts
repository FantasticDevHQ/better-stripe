import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { scopeFields, policyDoc, operationDoc } from "./schema.js";
import { readPolicy, validateScope } from "./helpers.js";
export const get = query({
  args: scopeFields,
  returns: v.union(policyDoc, v.null()),
  handler: readPolicy,
});
export const operation = query({
  args: { ...scopeFields, operationKey: v.string() },
  returns: v.union(operationDoc, v.null()),
  handler: async (ctx, args) => {
    validateScope(args);
    const op = await ctx.db
      .query("payoutPolicyOperations")
      .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (
      op &&
      (op.accountId !== args.accountId || op.ownerKey !== args.ownerKey)
    )
      throw new Error("Payout policy operation identity does not match.");
    return op;
  },
});
export const due = query({
  args: { now: v.number(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(policyDoc),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.now) ||
      args.now < 0 ||
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid payout policy due page.");
    const page = await paginator(ctx.db, schema)
      .query("payoutPolicies")
      .withIndex("by_deadline", (q) =>
        q.gt("holdDeadline", 0).lte("holdDeadline", args.now),
      )
      .paginate(args.paginationOpts);
    return {
      page: page.page,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
