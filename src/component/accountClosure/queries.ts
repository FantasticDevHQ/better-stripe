import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v, type Infer } from "convex/values";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import { closureByStripeId } from "./helpers.js";
import { closureDoc } from "./schema.js";
import { closureBlocker, readClosureBlockers } from "./blockers.js";

const currentOwnerResult = v.union(
  v.object({ status: v.literal("missing") }),
  v.object({ status: v.literal("ambiguous") }),
  v.object({
    status: v.literal("unique"),
    userId: v.string(),
    orgId: v.optional(v.string()),
  }),
);
export type CurrentClosureOwner = Infer<typeof currentOwnerResult>;

/** Missing live mapping and contradictory/duplicate ownership are distinct observations. */
export const currentOwner = query({
  args: { stripeAccountId: v.string() },
  returns: currentOwnerResult,
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .take(2);
    if (!rows.length) return { status: "missing" as const };
    if (rows.length !== 1) return { status: "ambiguous" as const };
    return {
      status: "unique" as const,
      userId: rows[0]!.userId,
      orgId: rows[0]!.orgId,
    };
  },
});

/** Trusted host read; no mutation, authorization or positive clearance. */
export const knownBlockers = query({
  args: { stripeAccountId: v.string() },
  returns: v.array(closureBlocker),
  handler: (ctx, args) => readClosureBlockers(ctx, args.stripeAccountId),
});
/** This is provenance, not end-user authentication; hosts must compare the authenticated owner. */
export const getClosedAccountByStripeId = query({
  args: { stripeAccountId: v.string() },
  returns: v.union(closureDoc, v.null()),
  handler: async (ctx, { stripeAccountId }) => {
    const closure = await closureByStripeId(ctx, stripeAccountId);
    return closure?.state === "closed" ? closure : null;
  },
});

export const listClosedAccountsByUserId = query({
  args: { userId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(closureDoc),
  handler: async (ctx, { userId, paginationOpts }) => {
    if (
      !Number.isInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 100
    )
      throw new Error("Closure history page size must be between 1 and 100");
    return paginator(ctx.db, schema)
      .query("accountClosures")
      .withIndex("by_user_state", (q) =>
        q.eq("userId", userId).eq("orgId", undefined).eq("state", "closed"),
      )
      .order("desc")
      .paginate({
        ...paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
  },
});
