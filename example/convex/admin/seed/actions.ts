import { STORE_CATALOGS } from "../../sandboxFixtures/plan";

import { env } from "../../_generated/server";

import Stripe from "stripe";

import { api, internal } from "../../_generated/api";

import { internalAction } from "../../_generated/server";

import { v } from "convex/values";

import { stripe } from "../../stripe/helpers";

import { assertTestModeStripeKey } from "../../users/authorization";
import {
  MARKETPLACE_PERSONAS,
  STRIPE_API_VERSION,
  activateTestRecipient,
} from "./helpers";

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
    const users = await ctx.runQuery(api.users.queries.list, {});

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
    if (!env.STRIPE_SECRET_KEY) {
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
      await ctx.runMutation(internal.admin.seed.mutations.linkUserAccount, {
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
        const rawStripe = new Stripe(env.STRIPE_SECRET_KEY, {
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
      await ctx.runMutation(internal.admin.seed.mutations.linkUserAccount, {
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
 * Seed a real V2 Stripe account per marketplace persona and link it back:
 *  - sellers   → recipient (receives transfers) + customer (billable for
 *                platform fees) configurations on ONE account, then activated
 *                via the test-recipient recipe.
 *  - affiliate → recipient configuration only, activated the same way.
 *  - buyer     → customer configuration + a reusable test card
 *                (`pm_card_visa`) attached to the `customer_account`.
 *
 * Action — makes Stripe API calls. Idempotent and resumable per persona, like
 * `seedAccounts`: only unlinked personas are created, so a partial failure can
 * be retried without duplicating accounts. The Stripe-calling branch needs a
 * live key + linked deployment (exercised via e2e, not unit tests); the guards
 * are unit-tested.
 */
export const seedMarketplaceAccounts = internalAction({
  args: {},
  returns: v.object({
    alreadySeeded: v.boolean(),
    linked: v.optional(v.number()),
  }),
  // Explicit return type breaks the api → seed → api inference cycle.
  handler: async (
    ctx,
  ): Promise<{ alreadySeeded: boolean; linked?: number }> => {
    const users = await ctx.runQuery(api.users.queries.list, {});
    const personas = MARKETPLACE_PERSONAS.map((p) => ({
      persona: p,
      user: users.find((u) => u.email === p.email),
    }));

    if (personas.some(({ user }) => !user)) {
      console.warn(
        "[seed] marketplace personas missing; run seedMarketplaceDb first — linking nothing.",
      );
      return { alreadySeeded: false, linked: 0 };
    }

    const unlinked = personas.flatMap(({ persona, user }) =>
      user && !user.stripeAccountId ? [{ persona, user }] : [],
    );
    if (unlinked.length === 0) {
      console.log("[seed] marketplace accounts already linked — skipping.");
      return { alreadySeeded: true };
    }

    if (!env.STRIPE_SECRET_KEY) {
      console.warn(
        "[seed] STRIPE_SECRET_KEY not set — skipping marketplace account linkage.",
      );
      return { alreadySeeded: false, linked: 0 };
    }

    let linked = 0;
    for (const { persona, user } of unlinked) {
      const account = await stripe.createAccount(ctx, {
        userId: user._id,
        email: user.email,
        name: user.name,
        country: "US",
      });
      const { stripeAccountId } = account;

      // Transfers require these settings in the same request that first
      // applies recipient capabilities. Keep sandbox recipients API-onboardable.
      if (persona.role !== "buyer") {
        await stripe.updateV2Account(ctx, {
          stripeAccountId,
          updateParams: {
            dashboard: "none",
            defaults: {
              responsibilities: {
                losses_collector: "application",
                fees_collector: "application",
              },
            },
            configuration: {
              recipient: {
                capabilities: {
                  stripe_balance: { stripe_transfers: { requested: true } },
                },
              },
            },
          },
        });
      }

      if (persona.role === "seller") {
        await stripe.addRecipientConfiguration(ctx, { stripeAccountId });
        await stripe.addCustomerConfiguration(ctx, { stripeAccountId });
        await activateTestRecipient(ctx, stripeAccountId);
      } else if (persona.role === "affiliate") {
        await stripe.addRecipientConfiguration(ctx, { stripeAccountId });
        await activateTestRecipient(ctx, stripeAccountId);
      } else {
        // Buyer: billable customer_account with a reusable test card, so
        // seeded purchases can charge off-session.
        await stripe.addCustomerConfiguration(ctx, { stripeAccountId });
        await stripe.attachPaymentMethod(ctx, {
          paymentMethodId: "pm_card_visa",
          stripeCustomerId: stripeAccountId,
        });
      }

      await ctx.runMutation(internal.admin.seed.mutations.linkUserAccount, {
        userId: user._id,
        stripeAccountId,
      });
      linked++;
    }

    console.log(`[seed] linked ${linked} marketplace account(s).`);
    return { alreadySeeded: false, linked };
  },
});

/**
 * Seed each store's catalog: products/prices created on the PLATFORM Stripe
 * account (the marketplace owns the catalog), tagged to the store via the
 * component's `accountId` field and `storeAccountId`/`storeName` metadata.
 *
 * Action — makes Stripe API calls. Idempotent per store: a store whose
 * account id already has tagged products is skipped, so a reseed after a
 * partial failure only fills the gaps. Requires `seedMarketplaceAccounts`
 * to have linked the sellers first.
 */
export const seedMarketplaceCatalog = internalAction({
  args: {},
  returns: v.object({
    alreadySeeded: v.boolean(),
    storesSeeded: v.number(),
  }),
  // Explicit return type breaks the api → seed → api inference cycle.
  handler: async (
    ctx,
  ): Promise<{ alreadySeeded: boolean; storesSeeded: number }> => {
    const users = await ctx.runQuery(api.users.queries.list, {});
    const sellers = MARKETPLACE_PERSONAS.filter(
      (p) => p.role === "seller",
    ).flatMap((p) => {
      const user = users.find((u) => u.email === p.email);
      return user?.stripeAccountId
        ? [{ ...user, stripeAccountId: user.stripeAccountId }]
        : [];
    });

    if (sellers.length === 0) {
      console.warn(
        "[seed] no linked marketplace sellers; run seedMarketplaceAccounts first — seeding nothing.",
      );
      return { alreadySeeded: false, storesSeeded: 0 };
    }

    // Per-store resumability: only stores with no tagged products need work.
    const pending = [];
    for (const seller of sellers) {
      const existing = await stripe.listProducts(ctx, {
        accountId: seller.stripeAccountId,
      });
      if (existing.length === 0) pending.push(seller);
    }
    if (pending.length === 0) {
      console.log("[seed] marketplace catalog already seeded — skipping.");
      return { alreadySeeded: true, storesSeeded: 0 };
    }

    if (!env.STRIPE_SECRET_KEY) {
      console.warn(
        "[seed] STRIPE_SECRET_KEY not set — skipping marketplace catalog.",
      );
      return { alreadySeeded: false, storesSeeded: 0 };
    }

    for (const seller of pending) {
      const catalog = STORE_CATALOGS[seller.email];
      if (!catalog) continue;

      const storeTag = {
        storeAccountId: seller.stripeAccountId,
        storeName: seller.storeName ?? seller.name,
      };
      const product = await stripe.createProduct(ctx, {
        name: catalog.product.name,
        description: catalog.product.description,
        // Component-side tag: this platform-owned product belongs to the store.
        accountId: seller.stripeAccountId,
        metadata: storeTag,
      });
      for (const price of catalog.prices) {
        await stripe.createPrice(ctx, {
          stripeProductId: product.stripeProductId,
          unitAmount: price.unitAmount,
          currency: "usd",
          type: price.type,
          interval: price.interval,
          nickname: price.nickname,
          metadata: storeTag,
        });
      }
      console.log(
        `[seed] seeded catalog for ${storeTag.storeName} (${seller.stripeAccountId}).`,
      );
    }

    return { alreadySeeded: false, storesSeeded: pending.length };
  },
});

/**
 * Full seed: DB users → Stripe products/prices → linked persona accounts (+ the
 * customer's subscription, which needs the monthly price to exist first), then
 * the marketplace scenario: personas → recipient/customer accounts → per-store
 * platform catalog. Called by the setup script.
 */
export const run = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (env.STRIPE_SECRET_KEY) assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    await ctx.runMutation(internal.admin.seed.mutations.seedDb, {});
    await ctx.runAction(internal.admin.seed.actions.seedStripe, {});
    await ctx.runAction(internal.admin.seed.actions.seedAccounts, {});
    await ctx.runMutation(internal.admin.seed.mutations.seedMarketplaceDb, {});
    await ctx.runAction(
      internal.admin.seed.actions.seedMarketplaceAccounts,
      {},
    );
    await ctx.runAction(internal.admin.seed.actions.seedMarketplaceCatalog, {});
    if (env.STRIPE_SECRET_KEY)
      await ctx.runAction(api.sandboxFixtures.public.actions.start, {});
    return null;
  },
});
