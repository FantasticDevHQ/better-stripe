import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { stripe } from "./stripe";
import { costScope } from "./lib/sellerRecovery";
export const recipient = { accountId: v.string(), ownerKey: v.string() };
export const scope = { ...recipient, currency: v.string() };
/** Demo owner binding. A production host must use its authenticated shared recipient mapping. */
export const liabilities = internalQuery({
  args: scope,
  returns: v.number(),
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
    if (user.role !== "seller") return 0;
    const balance = await stripe.costRecovery.balance(
      ctx,
      costScope(user._id, args.accountId, args.currency),
    );
    // Outstanding invoice reservations remain liabilities until their collection is verified.
    // Collected recovery is already reflected in the amount transferred to this store.
    const liability = balance.amountDue - balance.collectedAmount;
    if (!Number.isSafeInteger(liability))
      throw new Error("Invalid payout liability amount.");
    return Math.max(0, liability);
  },
});
