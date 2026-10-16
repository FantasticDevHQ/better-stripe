import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { stripe } from "../../stripe/helpers";

import { costScope } from "../../sellerCosts/recovery";
import { scope } from "./helpers";

/** Demo owner binding. A production host must use its authenticated shared recipient mapping. */
export const liabilities = internalQuery({
  args: scope,
  returns: v.object({
    independentLiabilities: v.number(),
    liabilityRevision: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!/^[a-z]{3}$/.test(args.currency))
      throw new Error("Invalid payout currency.");
    const id = ctx.db.normalizeId("users", args.ownerKey);
    const user = id ? await ctx.db.get("users", id) : null;
    if (
      !user ||
      user.stripeAccountId !== args.accountId ||
      !["seller", "affiliate"].includes(user.role)
    )
      throw new Error("Automatic payout owner binding is unavailable.");
    // The component reads this authorized scope's amount and account version atomically.
    // Outstanding invoice reservations remain owed until collection is verified.
    return stripe.costRecovery.payoutQuote(
      ctx,
      costScope(user._id, args.accountId, args.currency),
    );
  },
});
