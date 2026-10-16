import { v } from "convex/values";

import { query } from "../../_generated/server";

import { components } from "../../_generated/api";

import { canReceiveStorePayments } from "../recipient";

import { hasPaidStorePlan } from "../../storePlans/helpers";

import { stripe } from "../../stripe/helpers";
import { priceValidator } from "../helpers";

export const listStores = query({
  args: {},
  returns: v.array(
    v.object({
      sellerId: v.id("users"),
      name: v.string(),
      accountId: v.string(),
      products: v.array(
        v.object({
          name: v.string(),
          description: v.optional(v.string()),
          stripeProductId: v.string(),
          prices: v.array(priceValidator),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const sellers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "seller"))
      .take(100);
    const stores = await Promise.all(
      sellers
        .filter((s) => s.stripeAccountId && hasPaidStorePlan(s.storePlan))
        .map(async (seller) => {
          const account = await stripe.getAccountByStripeId(ctx, {
            stripeAccountId: seller.stripeAccountId!,
          });
          if (!canReceiveStorePayments(account)) return null;
          const products = await stripe.listProducts(ctx, {
            accountId: seller.stripeAccountId!,
          });
          return {
            sellerId: seller._id,
            name: seller.storeName ?? seller.name,
            accountId: seller.stripeAccountId!,
            products: await Promise.all(
              products
                .filter((p) => p.active)
                .map(async (product) => ({
                  name: product.name,
                  description: product.description,
                  stripeProductId: product.stripeProductId,
                  prices: (
                    await stripe.listPricesByProduct(ctx, {
                      stripeProductId: product.stripeProductId,
                    })
                  )
                    .filter((p) => p.active && p.unitAmount !== undefined)
                    .map((p) => ({
                      stripePriceId: p.stripePriceId,
                      unitAmount: p.unitAmount!,
                      currency: p.currency,
                      type: p.type,
                      interval: p.interval,
                    })),
                })),
            ),
          };
        }),
    );
    return stores.filter(
      (store): store is NonNullable<typeof store> => store !== null,
    );
  },
});

export const listStoreSubscriptions = query({
  args: { sellerId: v.id("users") },
  returns: v.array(
    v.object({
      stripeSubscriptionId: v.string(),
      status: v.string(),
      isTrialing: v.boolean(),
      cancelAtPeriodEnd: v.boolean(),
      currentPeriodEnd: v.optional(v.string()),
      trialEnd: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const seller = await ctx.db.get("users", args.sellerId);
    if (seller?.role !== "seller")
      throw new Error("Choose a seller to view store subscriptions.");
    if (!seller.stripeAccountId) return [];
    const products = await stripe.listProducts(ctx, {
      accountId: seller.stripeAccountId,
    });
    const rows = await Promise.all(
      products.map(async (product) => {
        const prices = await stripe.listPricesByProduct(ctx, {
          stripeProductId: product.stripeProductId,
        });
        return Promise.all(
          prices
            .filter((p) => p.type === "recurring")
            .map((p) =>
              ctx.runQuery(
                components.betterStripe.billing.queries
                  .listSubscriptionsByPrice,
                { priceId: p.stripePriceId },
              ),
            ),
        );
      }),
    );
    return rows.flat(2).map((s) => ({
      stripeSubscriptionId: s.stripeSubscriptionId,
      status: s.status,
      isTrialing: s.isTrialing,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      currentPeriodEnd: s.currentPeriodEnd,
      trialEnd: s.trialEnd,
    }));
  },
});
