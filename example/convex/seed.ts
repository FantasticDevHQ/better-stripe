import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { stripe } from "./stripe";

/**
 * Seed DB data (users). Mutation — no external calls.
 * Returns user IDs for logging. Skips if already seeded.
 */
export const seedDb = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existingUsers = await ctx.db.query("users").collect();
    if (existingUsers.length > 0) {
      console.log("[seed] DB already seeded — skipping.");
      return { alreadySeeded: true };
    }

    const customerId = await ctx.db.insert("users", {
      name: "Alex Customer",
      email: "alex@example.com",
      role: "customer",
    });

    const sellerId = await ctx.db.insert("users", {
      name: "Jordan Seller",
      email: "jordan@example.com",
      role: "seller",
    });

    await ctx.db.insert("users", {
      name: "Sam Admin",
      email: "sam@example.com",
      role: "admin",
    });

    console.log(
      `[seed] DB seeded: 3 users (customer=${customerId}, seller=${sellerId})`,
    );
    return { alreadySeeded: false };
  },
});

/**
 * Seed Stripe products and prices via BetterStripe. Action — makes Stripe API calls.
 * Idempotent: checks if products already exist in the component before creating.
 */
export const seedStripe = internalAction({
  args: {},
  handler: async (ctx) => {
    // Check if products already exist
    const existingProducts = await stripe.listProducts(ctx);
    if (existingProducts.length > 0) {
      console.log(
        `[seed] Stripe products already exist (${existingProducts.length}) — skipping.`,
      );
      return { alreadySeeded: true, productCount: existingProducts.length };
    }

    // Product 1: Classic Tee (one-time)
    const teeProduct = await stripe.createProduct(ctx, {
      name: "Classic Tee",
      description: "A premium cotton t-shirt with the better-stripe logo",
    });

    await stripe.createPrice(ctx, {
      stripeProductId: teeProduct.stripeProductId,
      unitAmount: 2900,
      currency: "usd",
      type: "one_time",
    });

    // Product 2: Tee of the Month Club (subscription)
    const clubProduct = await stripe.createProduct(ctx, {
      name: "Tee of the Month Club",
      description: "Get a fresh new tee delivered every month",
    });

    await stripe.createPrice(ctx, {
      stripeProductId: clubProduct.stripeProductId,
      unitAmount: 1900,
      currency: "usd",
      type: "recurring",
      interval: "month",
    });

    await stripe.createPrice(ctx, {
      stripeProductId: clubProduct.stripeProductId,
      unitAmount: 18900,
      currency: "usd",
      type: "recurring",
      interval: "year",
    });

    console.log("[seed] Stripe seeded: 2 products, 3 prices");
    return { alreadySeeded: false, productCount: 2 };
  },
});

/**
 * Full seed: DB data + Stripe products. Called by setup script.
 */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.seed.seedDb, {});
    await ctx.runAction(internal.seed.seedStripe, {});
  },
});
