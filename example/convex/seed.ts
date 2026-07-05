import Stripe from "stripe";

import { api, internal } from "./_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
} from "./_generated/server";
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
 * Core demo personas (BTS-7 added the visitor). Each role is a singleton, so
 * `seedDb` looks each one up by role and inserts only what's missing — a re-run
 * against a partially-seeded deployment (e.g. one first seeded before the
 * visitor persona existed, BTS-113) backfills the gap rather than silently
 * no-op'ing on the whole batch. Keep this seed step before anything that may
 * insert shared-role users (e.g. marketplace sellers): the `by_role` lookup
 * below intentionally assumes these four core roles have not yet been claimed.
 */
const CORE_PERSONAS = [
  { name: "Alex Customer", email: "alex@example.com", role: "customer" },
  { name: "Jordan Seller", email: "jordan@example.com", role: "seller" },
  { name: "Sam Admin", email: "sam@example.com", role: "admin" },
  // Visitor: a user with no Stripe account yet — `seedAccounts` deliberately
  // leaves this persona unlinked so the app can demonstrate the pre-onboarding
  // (gated, no-billing-data) state.
  { name: "Riley Visitor", email: "riley@example.com", role: "visitor" },
] as const;

/**
 * Seed DB data (core demo users). Mutation — no external calls.
 *
 * Idempotent per persona (not all-or-nothing): each core persona is a singleton
 * by role, so we look each role up and only insert what's missing. A re-run
 * against a partially-seeded deployment backfills the gaps — fixing the
 * BTS-113 bug where a deployment seeded before the visitor persona was added
 * could never acquire it no matter how many times seed was re-triggered.
 *
 * Returns the count of inserted personas for observability/tests (mirrors
 * `seedMarketplaceDb`'s `{ inserted: number }` shape).
 */
export const seedDb = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    let inserted = 0;
    for (const persona of CORE_PERSONAS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", persona.role))
        .first();
      if (existing) continue;
      await ctx.db.insert("users", {
        name: persona.name,
        email: persona.email,
        role: persona.role,
      });
      inserted++;
    }

    console.log(`[seed] core personas: inserted ${inserted}.`);
    return { inserted };
  },
});

/**
 * Marketplace personas (BTS-41). Two sellers who each own a store, an
 * affiliate who earns referral transfers, and a buyer who purchases from the
 * platform catalog. Emails double as the idempotency keys in
 * `seedMarketplaceDb`.
 */
const MARKETPLACE_PERSONAS = [
  {
    name: "Maya Merchant",
    email: "maya@example.com",
    role: "seller",
    storeName: "Maya's Fitness Studio",
  },
  {
    name: "Sasha Studio",
    email: "sasha@example.com",
    role: "seller",
    storeName: "Sasha's Ceramics",
  },
  { name: "Avery Affiliate", email: "avery@example.com", role: "affiliate" },
  { name: "Billie Buyer", email: "billie@example.com", role: "buyer" },
] as const;

/**
 * Seed the marketplace personas (sellers, affiliate, buyer). Mutation — no
 * external calls. Idempotent per persona: each email is inserted only if
 * missing, so a partial state backfills rather than duplicating.
 */
export const seedMarketplaceDb = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    let inserted = 0;
    for (const persona of MARKETPLACE_PERSONAS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", persona.email))
        .first();
      if (existing) continue;
      await ctx.db.insert("users", {
        name: persona.name,
        email: persona.email,
        role: persona.role,
        ...("storeName" in persona ? { storeName: persona.storeName } : {}),
      });
      inserted++;
    }

    console.log(`[seed] marketplace personas: inserted ${inserted}.`);
    return { inserted };
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

// =============================================================================
// Marketplace scenario (BTS-41)
// =============================================================================

/**
 * Activate a fresh test recipient's `stripe_balance.stripe_transfers`
 * capability entirely via API, so seeded transfers/splits succeed without
 * hosted onboarding. TEST MODE ONLY: the recipe (validated in the BTS-9/BTS-10
 * spikes) is a `dashboard: none` account + test SSN `000000000` (auto-verifies
 * in the sandbox) + an RFC3339 ToS attestation + a business URL. Express/full
 * dashboard accounts reject API ToS acceptance and must onboard via Stripe.
 */
async function activateTestRecipient(
  ctx: ActionCtx,
  stripeAccountId: string,
): Promise<void> {
  await stripe.updateV2Account(ctx, {
    stripeAccountId,
    updateParams: {
      identity: {
        entity_type: "individual",
        individual: {
          id_numbers: [{ type: "us_ssn", value: "000000000" }],
        },
        attestations: {
          terms_of_service: {
            account: {
              date: new Date().toISOString(),
              ip: "127.0.0.1",
            },
          },
        },
      },
      defaults: {
        profile: { business_url: "https://better-stripe.example.com" },
      },
    },
  });
}

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
    const users = await ctx.runQuery(api.users.list, {});
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

    if (!process.env.STRIPE_SECRET_KEY) {
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

      await ctx.runMutation(internal.seed.linkUserAccount, {
        userId: user._id,
        stripeAccountId,
      });
      linked++;
    }

    console.log(`[seed] linked ${linked} marketplace account(s).`);
    return { alreadySeeded: false, linked };
  },
});

/** What each store sells. Keyed by the seller persona's email. */
type StoreCatalog = {
  product: { name: string; description: string };
  prices: Array<{
    unitAmount: number;
    type: "one_time" | "recurring";
    interval?: "month" | "year";
    nickname?: string;
  }>;
};

const STORE_CATALOGS: Record<string, StoreCatalog> = {
  "maya@example.com": {
    product: {
      name: "Fitness Coaching Membership",
      description: "Weekly group coaching and training plans from Maya",
    },
    prices: [
      {
        unitAmount: 4900,
        type: "recurring",
        interval: "month",
        nickname: "Monthly",
      },
      {
        unitAmount: 49900,
        type: "recurring",
        interval: "year",
        nickname: "Yearly",
      },
      // One-time $100 session — the sale visualized by the affiliate-split
      // demo ($100 → store / affiliate / platform, BTS-43).
      {
        unitAmount: 10000,
        type: "one_time",
        nickname: "1:1 Session",
      },
    ],
  },
  "sasha@example.com": {
    product: {
      name: "Ceramics Masterclass",
      description: "A self-paced wheel-throwing course by Sasha",
    },
    prices: [{ unitAmount: 12900, type: "one_time", nickname: "Lifetime" }],
  },
};

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
    const users = await ctx.runQuery(api.users.list, {});
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

    if (!process.env.STRIPE_SECRET_KEY) {
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
    await ctx.runMutation(internal.seed.seedDb, {});
    await ctx.runAction(internal.seed.seedStripe, {});
    await ctx.runAction(internal.seed.seedAccounts, {});
    await ctx.runMutation(internal.seed.seedMarketplaceDb, {});
    await ctx.runAction(internal.seed.seedMarketplaceAccounts, {});
    await ctx.runAction(internal.seed.seedMarketplaceCatalog, {});
    return null;
  },
});
