import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

export const account = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || !["seller", "affiliate"].includes(user.role))
      throw new Error("Choose a seller or affiliate to view payouts.");
    if (!user.stripeAccountId)
      throw new Error("Stripe account has not been set up.");
    return user.stripeAccountId;
  },
});
