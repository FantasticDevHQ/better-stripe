import { v } from "convex/values";

import { internalQuery } from "../../../_generated/server";
import { doc } from "../helpers";

export const read = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.union(doc, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("storeBalanceFunding")
      .withIndex("by_seller", (q) => q.eq("sellerId", args.sellerId))
      .first(),
});
