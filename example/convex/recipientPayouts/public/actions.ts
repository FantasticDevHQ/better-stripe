import { v } from "convex/values";

import { stripe } from "../../stripe/helpers";

import { action } from "../../_generated/server";

import { internal } from "../../_generated/api";
import { resultValidator } from "../helpers";

/** Live recipient data. History is cursor-paginated rather than capped at 50 rows. */
export const load = action({
  args: { userId: v.id("users"), cursor: v.optional(v.string()) },
  returns: resultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<import("convex/values").Infer<typeof resultValidator>> => {
    const accountId = await ctx.runQuery(
      internal.recipientPayouts.internal.queries.account,
      {
        userId: args.userId,
      },
    );
    return stripe.getPayoutSnapshot(ctx, {
      stripeAccountId: accountId,
      cursor: args.cursor,
    });
  },
});
