import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { sellerCostDoc } from "../validators";

export const legacyBatch = internalQuery({
  args: { sellerId: v.id("users") },
  returns: v.array(sellerCostDoc),
  handler: (ctx, args) =>
    ctx.db
      .query("sellerCosts")
      .withIndex("by_recovery_version", (q) =>
        q.eq("sellerId", args.sellerId).eq("recoveryVersion", undefined),
      )
      .take(20),
});
