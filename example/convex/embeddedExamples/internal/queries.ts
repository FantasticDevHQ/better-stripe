import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { kind } from "../helpers";

export const actor = internalQuery({
  args: { userId: v.id("users"), kind },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || !["seller", "affiliate"].includes(user.role))
      throw new Error("Choose a seller or affiliate for Connect examples.");
    if (
      ["payments", "refunds", "disputes"].includes(args.kind) &&
      user.role !== "seller"
    )
      throw new Error("Only a seller can manage store payments.");
    if (!user.stripeAccountId)
      throw new Error("Set up this persona's Stripe account first.");
    return user.stripeAccountId;
  },
});
