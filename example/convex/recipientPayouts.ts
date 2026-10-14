import { v } from "convex/values";
import { stripe } from "./stripe";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

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
const payout = v.object({
  id: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: v.string(),
  arrivalDate: v.union(v.number(), v.null()),
  created: v.number(),
});
const fields = {
  status: v.union(v.literal("ready"), v.literal("not_ready")),
  reason: v.optional(v.string()),
  upcomingComplete: v.boolean(),
  balances: v.array(
    v.object({
      currency: v.string(),
      available: v.number(),
      pending: v.number(),
    }),
  ),
  payouts: v.array(payout),
  upcoming: v.array(payout),
  nextCursor: v.union(v.string(), v.null()),
};
const resultValidator = v.object(fields);
/** Live recipient data. History is cursor-paginated rather than capped at 50 rows. */
export const load = action({
  args: { userId: v.id("users"), cursor: v.optional(v.string()) },
  returns: resultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<import("convex/values").Infer<typeof resultValidator>> => {
    const accountId = await ctx.runQuery(internal.recipientPayouts.account, {
      userId: args.userId,
    });
    return stripe.getPayoutSnapshot(ctx, {
      stripeAccountId: accountId,
      cursor: args.cursor,
    });
  },
});
