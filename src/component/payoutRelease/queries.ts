import { previewFields, previewResult, previewPlan } from "./preview.js";
import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { transferDocValidator } from "../connect/validators.js";
import { readFees } from "./fees.js";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { identity, claimDoc } from "./schema.js";
import { validateIdentity } from "./helpers.js";
import { readPolicy } from "../payoutPolicy/helpers.js";
export const preview = query({
  args: previewFields,
  returns: previewResult,
  handler: previewPlan,
});
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
    const result = await paginator(ctx.db, schema)
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

export const fees = query({
  args: { accountId: v.string(), ownerKey: v.string(), currency: v.string() },
  returns: v.object({ amount: v.number(), revision: v.number() }),
  handler: async (ctx, args) => {
    await readPolicy(ctx, args);
    const balance = await readFees(ctx, args);
    return { amount: balance?.amount ?? 0, revision: balance?.revision ?? 0 };
  },
});

/** Complete bounded input for package qualification. Partial membership never qualifies. */
export const snapshot = query({
  args: { accountId: v.string(), ownerKey: v.string() },
  returns: v.union(
    v.object({
      status: v.literal("held"),
      reason: v.literal("snapshot_limit"),
    }),
    v.object({
      status: v.literal("ready"),
      transfers: v.array(transferDocValidator),
      claims: v.array(claimDoc),
    }),
  ),
  handler: async (ctx, args) => {
    await readPolicy(ctx, args);
    const transfers = await ctx.db
      .query("transfers")
      .withIndex("by_destination_account_id", (q) =>
        q.eq("destinationAccountId", args.accountId),
      )
      .take(101);
    const claims = await ctx.db
      .query("payoutReleaseClaims")
      .withIndex("by_account_status", (q) => q.eq("accountId", args.accountId))
      .take(101);
    if (transfers.length > 100 || claims.length > 100)
      return { status: "held" as const, reason: "snapshot_limit" as const };
    if (claims.some((c) => c.ownerKey !== args.ownerKey))
      throw new Error("Payout history owner does not match.");
    return { status: "ready" as const, transfers, claims };
  },
});
