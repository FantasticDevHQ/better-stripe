import { v } from "convex/values";
import { mutation } from "../_generated/server.js";
import { closureByStripeId } from "./helpers.js";
import { closureDoc } from "./schema.js";
/** Trusted host boundary: authenticate and authorize the actor before invoking close. */
export const prepare = mutation({
  args: { stripeAccountId: v.string() },
  returns: v.object({ closure: closureDoc, isRetry: v.boolean() }),
  handler: async (ctx, { stripeAccountId }) => {
    const payerLock = await ctx.db
      .query("usageSubscriptionLocks")
      .withIndex("by_payer", (q) => q.eq("customerAccount", stripeAccountId))
      .first();
    const realmLock = await ctx.db
      .query("usageSubscriptionLocks")
      .withIndex("by_realm", (q) => q.eq("stripeAccountId", stripeAccountId))
      .first();
    if (payerLock || realmLock)
      throw new Error(
        "Close out managed usage enrollment before account closure",
      );
    const existing = await closureByStripeId(ctx, stripeAccountId);
    if (existing) return { closure: existing, isRetry: true };
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", stripeAccountId),
      )
      .unique();
    const id = await ctx.db.insert("accountClosures", {
      stripeAccountId,
      userId: account?.userId,
      orgId: account?.orgId,
      appliedConfigurations: account?.appliedConfigurations,
      state: "pending",
    });
    const closure = await ctx.db.get("accountClosures", id);
    if (!closure) throw new Error("Closure intent was not persisted");
    return { closure, isRetry: false };
  },
});

export const complete = mutation({
  args: { stripeAccountId: v.string() },
  returns: v.null(),
  handler: async (ctx, { stripeAccountId }) => {
    const closure = await closureByStripeId(ctx, stripeAccountId);
    if (!closure) throw new Error("Closure intent is required");
    if (closure.state === "closed") return null;
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_stripe_account_id", (q) =>
        q.eq("stripeAccountId", stripeAccountId),
      )
      .unique();
    if (
      account &&
      (account.userId !== closure.userId || account.orgId !== closure.orgId)
    )
      throw new Error("Account ownership changed during closure");
    await ctx.db.patch("accountClosures", closure._id, {
      state: "closed",
      closedAt: Date.now(),
    });
    if (account) await ctx.db.delete("accounts", account._id);
    return null;
  },
});
