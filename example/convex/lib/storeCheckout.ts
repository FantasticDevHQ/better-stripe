import { v } from "convex/values";
import { stripe } from "../stripe";
import { api, internal } from "../_generated/api";
import { isAffiliateReferral } from "../affiliateSplit";
import { checkoutModeForPrice } from "./marketplace";
import type { ActionCtx } from "../_generated/server";
export const checkoutArgs = {
  userId: v.optional(v.id("users")),
  stripePriceId: v.string(),
  referralCode: v.optional(v.string()),
  returnUrl: v.string(),
  uiMode: v.optional(
    v.union(
      v.literal("embedded"),
      v.literal("custom"),
      v.literal("redirect"),
      v.literal("form"),
    ),
  ),
  cancelUrl: v.optional(v.string()),
};
export const checkoutResult = v.object({
  stripeSessionId: v.string(),
  clientSecret: v.optional(v.string()),
  url: v.optional(v.string()),
});
export async function createStoreCheckout(
  ctx: ActionCtx,
  args: import("convex/values").Infer<typeof checkoutArgsValidator>,
): Promise<import("convex/values").Infer<typeof checkoutResult>> {
  const price = await stripe.getPriceByStripeId(ctx, {
    stripePriceId: args.stripePriceId,
  });
  if (
    !price?.active ||
    !Number.isSafeInteger(price.unitAmount) ||
    price.unitAmount! <= 0
  ) {
    throw new Error("This price is not available for purchase.");
  }
  const product = await stripe.getProductByStripeId(ctx, {
    stripeProductId: price.stripeProductId,
  });
  if (!product?.active)
    throw new Error("This product is not available for purchase.");
  const sellerAccountId = product.accountId;
  const identity = await ctx.runQuery(
    internal.storefront.checkoutParticipants,
    { userId: args.userId, sellerAccountId },
  );
  const account = identity.userId
    ? await ctx.runQuery(api.queries.getAccountByUserId, {
        userId: identity.userId,
      })
    : null;
  if (
    isAffiliateReferral(args.referralCode) &&
    sellerAccountId &&
    !identity.affiliateAccountId
  ) {
    throw new Error(
      "The affiliate account is not ready. Try a direct store purchase.",
    );
  }
  return stripe.createCheckoutSession(ctx, {
    userId: identity.userId,
    accountId: account?.stripeAccountId,
    customerEmail: identity.email,
    stripePriceId: args.stripePriceId,
    amount: price.unitAmount,
    mode: checkoutModeForPrice(price),
    sessionOverrides: {
      adaptive_pricing: { enabled: false },
      ...(args.uiMode === "redirect" && args.cancelUrl
        ? { cancel_url: args.cancelUrl }
        : {}),
    },
    returnUrl: args.returnUrl,
    uiMode: args.uiMode ?? "embedded",
    metadata: {
      referralCode: isAffiliateReferral(args.referralCode) ? "avery" : "",
      productName: product.name,
      stripeProductId: price.stripeProductId,
      stripePriceId: args.stripePriceId,
      storeBilling: "sale_v1",
      sellerId: identity.sellerId,
      planId: identity.planId,
      affiliateAccountId: isAffiliateReferral(args.referralCode)
        ? identity.affiliateAccountId!
        : "",
    },
  });
}
export const checkoutArgsValidator = v.object(checkoutArgs);
