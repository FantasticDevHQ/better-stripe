import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { identity, claimDoc } from "./schema.js";
import { validateIdentity } from "./helpers.js";
import { readPolicy } from "../payoutPolicy/helpers.js";
export const get = query({
  args: identity,
  returns: v.union(claimDoc, v.null()),
  handler: async (ctx, args) => {
    validateIdentity(args);
    await readPolicy(ctx, args);
    const claim = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_operation", (q) => q.eq("operationKey", args.operationKey))
      .unique();
    if (
      claim &&
      (claim.accountId !== args.accountId || claim.ownerKey !== args.ownerKey)
    )
      throw new Error("Payout claim identity does not match.");
    return claim;
  },
});
export const pending = query({
  args: {
    accountId: v.string(),
    ownerKey: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(claimDoc),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await readPolicy(ctx, args);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid payout claim page.");
    const result = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_account_status", (q) =>
        q.eq("accountId", args.accountId).eq("status", "reserved"),
      )
      .paginate(args.paginationOpts);
    return {
      page: result.page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
