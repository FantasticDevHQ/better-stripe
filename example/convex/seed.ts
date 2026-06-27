import Stripe from "stripe";

import { api, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";

import { stripe } from "./stripe";

// Match the API version the BetterStripe client pins, so the raw client used to
// seed a subscription speaks the same V2 dialect. Typed off the SDK's own
// constructor config (stripe@22 no longer re-exports an ApiVersion literal).
type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;
const STRIPE_API_VERSION: StripeApiVersion = "2026-05-27.dahlia";

/**
 * Seed DB data (users). Mutation — no external calls.
 * Returns user IDs for logging. Skips if already seeded.
 */
export const seedDb = internalMutation({
  args: {},
  returns: v.object({ alreadySeeded: v.boolean() }),
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

    // Visitor: a user with no Stripe account yet — `seedAccounts` deliberately
    // leaves this persona unlinked so the app can demonstrate the pre-onboarding
    // (gated, no-billing-data) state.
    await ctx.db.insert("users", {
      name: "Riley Visitor",
      email: "riley@example.com",
      role: "visitor",
    });

    console.log(
      `[seed] DB seeded: 4 users (customer=${customerId}, seller=${sellerId})`,
    );
    return { alreadySeeded: false };
  },
});

/**
 * Write a created Stripe account id back onto a seeded user row. Internal —
 * called by `seedAccounts` after it creates each persona's V2 account.
 */
export const linkUserAccount = internalMutation({
  args: { userId: v.id("users"), stripeAccountId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, stripeAccountId }) => {
    await ctx.db.patch(userId, { stripeAccountId });
    return null;
  },
});

/**
 * Seed a real V2 Stripe account per persona and link it to the user row:
 *  - customer → account + customer configuration (billable) + a trialing
 *    subscription on the monthly club price, attributed via `customer_account`.
 *  - seller   → account with the default merchant configuration (onboarding).
 *  - admin    → no account (platform operator).
 *
 * Action — makes Stripe API calls. Idempotent: short-circuits once any user is
 * already linked. Like `seedStripe`, the account-creating branch needs a live
 * Stripe key + linked deployment and is exercised by `e2e:webhooks`, not unit
 * tests; the already-linked guard is unit-tested.
 */
export const seedAccounts = internalAction({
  args: {},
  returns: v.object({
    alreadySeeded: v.boolean(),
    linked: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const users = await ctx.runQuery(api.users.list, {});

    const customer = users.find((u) => u.role === "customer");
    const seller = users.find((u) => u.role === "seller");
    if (!customer || !seller) {
      console.warn(
        "[seed] expected customer & seller users; run seedDb first — linking nothing.",
      );
      return { alreadySeeded: false, linked: 0 };
    }

    // Per-persona resumability: only personas that aren't already linked need
    // work, so a partial failure (e.g. seller fails after customer links) can be
    // retried without wedging or duplicating the already-linked accounts.
    const needsCustomer = !customer.stripeAccountId;
    const needsSeller = !seller.stripeAccountId;
    if (!needsCustomer && !needsSeller) {
      console.log("[seed] accounts already linked — skipping.");
      return { alreadySeeded: true };
    }

    // Account creation needs a live Stripe key. Without one, skip linkage rather
    // than crash the whole seed (mirrors how seedStripe's create branch is
    // exercised only via e2e:webhooks).
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn(
        "[seed] STRIPE_SECRET_KEY not set — skipping persona account linkage.",
      );
      return { alreadySeeded: false, linked: 0 };
    }

    let linked = 0;

    // Customer: create the account, make it billable, link it back, then give
    // it real owned billing data. The subscription is created in the same step
    // as the account so a re-run (customer already linked) won't duplicate it.
    if (needsCustomer) {
      const customerAccount = await stripe.createAccount(ctx, {
        userId: customer._id,
        email: customer.email,
        name: customer.name,
        country: "US",
      });
      await stripe.addCustomerConfiguration(ctx, {
        stripeAccountId: customerAccount.stripeAccountId,
      });
      await ctx.runMutation(internal.seed.linkUserAccount, {
        userId: customer._id,
        stripeAccountId: customerAccount.stripeAccountId,
      });
      linked++;

      // A trialing subscription on the monthly club price, keyed by
      // `customer_account` (acct_…). The trial means no payment method is
      // required; the resulting webhook is attributed to the customer's userId
      // (metadata) and acct_… (customer_account).
      const prices = await stripe.listPrices(ctx);
      const monthlyPrice = prices.find(
        (p) => p.type === "recurring" && p.interval === "month",
      );
      if (monthlyPrice) {
        const rawStripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: STRIPE_API_VERSION,
        });
        await rawStripe.subscriptions.create({
          customer_account: customerAccount.stripeAccountId,
          items: [{ price: monthlyPrice.stripePriceId }],
          trial_period_days: 14,
          metadata: { userId: customer._id },
        });
      } else {
        console.warn(
          "[seed] no monthly recurring price found — skipping customer subscription. Run seedStripe first.",
        );
      }
    }

    // Seller: create the account with the default merchant configuration.
    if (needsSeller) {
      const sellerAccount = await stripe.createAccountWithOnboarding(ctx, {
        userId: seller._id,
        email: seller.email,
        name: seller.name,
        country: "US",
        refreshUrl: "https://example.com/onboarding/refresh",
        returnUrl: "https://example.com/onboarding/return",
      });
      await ctx.runMutation(internal.seed.linkUserAccount, {
        userId: seller._id,
        stripeAccountId: sellerAccount.stripeAccountId,
      });
      linked++;
    }

    console.log(`[seed] linked ${linked} persona account(s).`);
    return { alreadySeeded: false, linked };
  },
});

/**
 * Seed Stripe products and prices via BetterStripe. Action — makes Stripe API calls.
 * Idempotent: checks if products already exist in the component before creating.
 */
export const seedStripe = internalAction({
  args: {},
  returns: v.object({
    alreadySeeded: v.boolean(),
    productCount: v.number(),
  }),
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
 * Full seed: DB users → Stripe products/prices → linked persona accounts (+ the
 * customer's subscription, which needs the monthly price to exist first).
 * Called by the setup script.
 */
export const run = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(internal.seed.seedDb, {});
    await ctx.runAction(internal.seed.seedStripe, {});
    await ctx.runAction(internal.seed.seedAccounts, {});
    return null;
  },
});
