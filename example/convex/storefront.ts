import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { components } from "./_generated/api";
import { canReceiveStorePayments } from "./lib/storeRecipient";
import { hasPaidStorePlan } from "./lib/storePlans";
import { storePlanIdValidator } from "./lib/storePlanValidators";
import { stripe } from "./stripe";

const priceValidator = v.object({
  stripePriceId: v.string(),
  unitAmount: v.number(),
  currency: v.string(),
  type: v.string(),
  interval: v.optional(v.string()),
});
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
