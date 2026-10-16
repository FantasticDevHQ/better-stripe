import { v } from "convex/values";

import { action, env } from "../_generated/server";

import { api, internal } from "../_generated/api";

import { stripe } from "../stripe/helpers";

import { assertTestModeStripeKey } from "../users/authorization";

import { isAffiliateReferral } from "../marketplace/affiliateSplit";

export const createPaymentIntent = action({
  args: {
    userId: v.optional(v.id("users")),
    stripePriceId: v.string(),
    referralCode: v.optional(v.string()),
    requestId: v.string(),
  },
  returns: v.object({ paymentIntentId: v.string(), clientSecret: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ paymentIntentId: string; clientSecret: string }> => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(args.requestId))
      throw new Error("Invalid checkout request ID.");
    const price = await stripe.getPriceByStripeId(ctx, {
      stripePriceId: args.stripePriceId,
    });
    if (
      !price?.active ||
      price.type !== "one_time" ||
      !Number.isSafeInteger(price.unitAmount) ||
      price.unitAmount! <= 0
    )
      throw new Error(
        "Payment Intents in this example support active one-time prices. Choose Checkout Sessions for subscriptions.",
      );
    const product = await stripe.getProductByStripeId(ctx, {
      stripeProductId: price.stripeProductId,
    });
    if (!product?.active) throw new Error("This product is unavailable.");
    const identity = await ctx.runQuery(
      internal.storefront.internal.queries.checkoutParticipants,
      { userId: args.userId, sellerAccountId: product.accountId },
    );
    const customer = identity.userId
      ? await ctx.runQuery(api.accounts.queries.getAccountByUserId, {
          userId: identity.userId,
        })
      : null;
    const referred = isAffiliateReferral(args.referralCode);
    if (referred && !identity.affiliateAccountId)
      throw new Error("The affiliate account is not ready.");
    return await stripe.createPaymentIntent(ctx, {
      userId: identity.userId,
      stripePriceId: args.stripePriceId,
      customerAccount: customer?.stripeAccountId,
      receiptEmail: identity.email,
      paymentMethods: "automatic",
      idempotencyKey: `example_pi_${identity.userId || "guest"}_${args.stripePriceId}_${args.requestId}`,
      metadata: {
        userId: identity.userId,
        storeBilling: "sale_v1",
        sellerId: identity.sellerId,
        planId: identity.planId,
        affiliateAccountId: referred ? identity.affiliateAccountId! : "",
        productName: product.name,
        stripeProductId: price.stripeProductId,
        stripePriceId: args.stripePriceId,
        checkoutType: "payment_intent",
      },
    });
  },
});
