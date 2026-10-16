import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import { closureByStripeId } from "./helpers.js";
import { closureDoc } from "./schema.js";
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
