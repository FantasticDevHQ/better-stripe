import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import { payoutReleaseFields } from "../affiliateRecovery/schema.js";
export const pendingPayouts = query({
  args: {
    state: v.union(v.literal("pending"), v.literal("unknown")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      ...payoutReleaseFields,
      _id: v.id("affiliatePayoutReleases"),
      _creationTime: v.number(),
    }),
  ),
  handler: (ctx, args) =>
    ctx.db
      .query("affiliatePayoutReleases")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(10, args.paginationOpts.numItems),
      }),
});
