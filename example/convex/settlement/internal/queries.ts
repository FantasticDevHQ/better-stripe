import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { storeSaleDocValidator } from "../../storePlans/validators";

export const getByCharge = internalQuery({
  args: { chargeId: v.string() },
  returns: v.union(storeSaleDocValidator, v.null()),
  handler: (ctx, args) =>
    ctx.db
      .query("storeSales")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .first(),
});
