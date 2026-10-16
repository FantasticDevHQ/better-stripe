import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

import { canReceiveStorePayments } from "../recipient";

import { hasPaidStorePlan } from "../../storePlans/helpers";

import { storePlanIdValidator } from "../../storePlans/validators";

import { stripe } from "../../stripe/helpers";

export const checkoutParticipants = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    sellerAccountId: v.optional(v.string()),
  },
  returns: v.object({
    userId: v.string(),
    email: v.optional(v.string()),
    affiliateAccountId: v.optional(v.string()),
    sellerId: v.id("users"),
    planId: storePlanIdValidator,
  }),
  handler: async (ctx, args) => {
    const user = args.userId ? await ctx.db.get("users", args.userId) : null;
    if (
      args.userId &&
      (!user || (user.role !== "customer" && user.role !== "buyer"))
    ) {
      throw new Error("Choose Customer or Visitor to purchase from a seller.");
    }
    if (!args.sellerAccountId) throw new Error("Choose a seller product.");
    const seller = await ctx.db
      .query("users")
      .withIndex("by_stripe_account", (q) =>
        q.eq("stripeAccountId", args.sellerAccountId),
      )
      .first();
    if (seller?.role !== "seller")
      throw new Error("This seller is not available.");
    if (!hasPaidStorePlan(seller.storePlan))
      throw new Error(
        "This seller needs a paid store plan before accepting purchases.",
      );
    const account = await stripe.getAccountByStripeId(ctx, {
      stripeAccountId: args.sellerAccountId,
    });
    if (!canReceiveStorePayments(account))
      throw new Error(
        "This seller must finish Stripe onboarding before accepting purchases.",
      );
    const affiliate = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "avery@example.com"))
      .first();
    return {
      sellerId: seller._id,
      planId: seller.storePlan!.planId,
      userId: user?._id ?? "",
      email: user?.email,
      affiliateAccountId:
        affiliate?.role === "affiliate" ? affiliate.stripeAccountId : undefined,
    };
  },
});
