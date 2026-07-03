/**
 * Real (test-mode) Stripe webhook triggers for the admin Testing page
 * (BTS-45).
 *
 * TEST-ONLY. Every action here makes a REAL Stripe test-mode API call — no
 * synthetic/mocked events — against the seeded marketplace demo personas
 * (Maya's store, Billie the buyer; run `npm run setup` first). Firing an
 * event only reaches the component ledger if `stripe listen --forward-to
 * <site>/stripe/webhook` is running locally (see README → "Browser E2E
 * Tests"), so each action polls the resulting component row for a few
 * seconds and reports whether the sync was actually observed — never a
 * canned success string.
 *
 * NOT unit-runnable end to end: the actions call live Stripe (test mode) and
 * depend on a linked dev deployment, same as `e2eMoney.ts`. Only the pure
 * `describeLedgerSync` helper is unit-tested (`adminTesting.test.ts`); the
 * actions are typecheck- + lint-covered.
 */
import Stripe from "stripe";
import { makeFunctionReference } from "convex/server";
import type { RegisteredQuery } from "convex/server";

import { action, query, type ActionCtx } from "./_generated/server";
import type { getMarketplaceDemoContext } from "./marketplace";
import { stripe } from "./stripe";

// Match the API version the BetterStripe client pins (see seed.ts, e2eMoney.ts).
type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;
const STRIPE_API_VERSION: StripeApiVersion = "2026-05-27.dahlia";

function rawStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set on the deployment");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2_000;

// ─── Seeded demo persona lookup ────────────────────────────────────────────

/** Maya's store account + Billie the buyer's account, resolved from the BTS-41 marketplace seed. */
export const getDemoAccounts = query({
  args: {},
  handler: async (ctx) => {
    const store = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "maya@example.com"))
      .first();
    const buyer = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "billie@example.com"))
      .first();
    if (!store?.stripeAccountId || !buyer?.stripeAccountId) return null;
    return {
      storeAccountId: store.stripeAccountId,
      buyerUserId: buyer._id,
      buyerAccountId: buyer.stripeAccountId,
    };
  },
});

type QueryReturn<Query> =
  Query extends RegisteredQuery<"public" | "internal", Record<string, unknown>, infer Return>
    ? Awaited<Return>
    : never;
type DemoAccounts = QueryReturn<typeof getDemoAccounts>;
type MarketplaceDemoContext = QueryReturn<typeof getMarketplaceDemoContext>;

const getDemoAccountsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  DemoAccounts
>("adminTesting:getDemoAccounts");

const getPaymentRowRef = makeFunctionReference<
  "query",
  { stripePaymentIntentId: string },
  unknown
>("e2eMoney:getPaymentRow");

const getMarketplaceDemoContextRef = makeFunctionReference<
  "query",
  Record<string, never>,
  MarketplaceDemoContext
>("marketplace:getMarketplaceDemoContext");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Formats whether the component ledger observed the event, and how long that took. */
export function describeLedgerSync(
  found: boolean,
  attempts: number,
  maxAttempts: number,
): string {
  if (found) {
    return `Synced to the component ledger after ${attempts}/${maxAttempts} poll${attempts === 1 ? "" : "s"}.`;
  }
  return (
    `Not yet synced after ${maxAttempts} polls — is ` +
    "`stripe listen --forward-to <site>/stripe/webhook` running? " +
    'See README → "Browser E2E Tests".'
  );
}

/** Poll `check` until it returns a truthy row, or give up. */
async function pollForLedgerRow<T>(
  check: () => Promise<T | null | undefined>,
): Promise<{ row: T | null; attempts: number }> {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    const row = await check();
    if (row) return { row, attempts: attempt };
    if (attempt < POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  return { row: null, attempts: POLL_ATTEMPTS };
}

async function requireDemoAccounts(ctx: ActionCtx) {
  const accounts = await ctx.runQuery(getDemoAccountsRef, {});
  if (!accounts) {
    throw new Error(
      "Marketplace store/buyer not seeded — run `npm run setup` first.",
    );
  }
  return accounts;
}

// ─── Account Updated ──────────────────────────────────────────────────────

/**
 * Real `v2.core.accounts.update` metadata bump on the seeded store account —
 * fires a genuine `v2.core.account.updated` thin event. Metadata-only, so
 * it's safe to click repeatedly without disturbing the account's onboarding
 * state or capabilities.
 */
export const fireAccountUpdated = action({
  args: {},
  handler: async (ctx) => {
    const { storeAccountId } = await requireDemoAccounts(ctx);
    const pingedAt = new Date().toISOString();

    await stripe.updateV2Account(ctx, {
      stripeAccountId: storeAccountId,
      updateParams: { metadata: { bsAdminTestPing: pingedAt } },
    });

    const { row, attempts } = await pollForLedgerRow(() =>
      stripe.getAccountByStripeId(ctx, { stripeAccountId: storeAccountId }),
    );

    return {
      stripeAccountId: storeAccountId,
      pingedAt,
      ledgerSync: describeLedgerSync(!!row, attempts, POLL_ATTEMPTS),
      componentRow: row,
    };
  },
});

// ─── Subscription Updated ─────────────────────────────────────────────────

/**
 * Real `subscriptions.update` metadata bump on the buyer's active
 * subscription to the seeded store — fires a genuine
 * `customer.subscription.updated` event. Requires an active subscription
 * (created via `/demo/subscribe` or the "Invoice Paid" trigger below).
 */
export const fireSubscriptionUpdated = action({
  args: {},
  handler: async (ctx) => {
    const { storeAccountId, buyerUserId } = await requireDemoAccounts(ctx);

    const active = await stripe.getActiveSubscription(ctx, {
      userId: buyerUserId,
      destinationAccountId: storeAccountId,
    });
    if (!active) {
      throw new Error(
        'No active subscription for the buyer — click "Invoice Paid" first, or subscribe via /demo/subscribe.',
      );
    }

    const pingedAt = new Date().toISOString();
    await stripe.updateSubscriptionMetadata(ctx, {
      stripeSubscriptionId: active.stripeSubscriptionId,
      metadata: { bsAdminTestPing: pingedAt },
    });

    const { row, attempts } = await pollForLedgerRow(() =>
      stripe.getSubscriptionByStripeId(ctx, {
        stripeSubscriptionId: active.stripeSubscriptionId,
      }),
    );

    return {
      stripeSubscriptionId: active.stripeSubscriptionId,
      pingedAt,
      ledgerSync: describeLedgerSync(!!row, attempts, POLL_ATTEMPTS),
      componentRow: row,
    };
  },
});

// ─── Checkout Completed (one-time payment) ────────────────────────────────

const ADMIN_TEST_PAYMENT_AMOUNT = 500; // $5.00 — small, fixed, test-mode only.

/**
 * A real, immediately-confirmed one-time PaymentIntent against the seeded
 * store (destination charge) — mirrors `e2eMoney.ts`'s `e2eDestinationFeeSale`
 * driver. Fires genuine `payment_intent.succeeded` / `charge.succeeded`
 * events. Creates a fresh, isolated Stripe object each click — never mutates
 * existing demo state.
 */
export const fireCheckoutCompleted = action({
  args: {},
  handler: async (ctx) => {
    const { storeAccountId } = await requireDemoAccounts(ctx);
    const raw = rawStripe();

    const pi = await raw.paymentIntents.create({
      amount: ADMIN_TEST_PAYMENT_AMOUNT,
      currency: "usd",
      confirm: true,
      payment_method: "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      transfer_data: { destination: storeAccountId },
      metadata: { bsAdminTest: "checkout-completed" },
    });

    const { row, attempts } = await pollForLedgerRow(() =>
      ctx.runQuery(getPaymentRowRef, {
        stripePaymentIntentId: pi.id,
      }),
    );

    return {
      stripePaymentIntentId: pi.id,
      status: pi.status,
      amount: ADMIN_TEST_PAYMENT_AMOUNT,
      ledgerSync: describeLedgerSync(!!row, attempts, POLL_ATTEMPTS),
      componentRow: row,
    };
  },
});

// ─── Invoice Paid (new subscription) ──────────────────────────────────────

/**
 * Create a brand-new subscription (off-checkout) for the seeded buyer against
 * the seeded store's monthly price, no trial. The first invoice finalizes and
 * pays synchronously against the buyer's already-attached `pm_card_visa`
 * (seeded via `attachPaymentMethod`), firing a genuine `invoice.paid` event.
 * Creates a fresh, isolated subscription each click — never mutates an
 * existing subscription.
 */
export const fireInvoicePaid = action({
  args: {},
  handler: async (ctx) => {
    const { storeAccountId, buyerUserId, buyerAccountId } =
      await requireDemoAccounts(ctx);

    const context = await ctx.runQuery(
      getMarketplaceDemoContextRef,
      {},
    );
    if (!context) {
      throw new Error(
        "Marketplace demo context not seeded — run `npm run setup` first.",
      );
    }

    const sub = await stripe.createSubscription(ctx, {
      userId: buyerUserId,
      customerAccount: buyerAccountId,
      stripePriceId: context.price.stripePriceId,
      destinationAccountId: storeAccountId,
      metadata: { bsAdminTest: "invoice-paid" },
    });

    const { row, attempts } = await pollForLedgerRow(async () => {
      const invoices = await stripe.listInvoices(ctx, {
        subscriptionId: sub.stripeSubscriptionId,
      });
      return invoices.find((i) => i.status === "paid") ?? null;
    });

    return {
      stripeSubscriptionId: sub.stripeSubscriptionId,
      subscriptionStatus: sub.status,
      ledgerSync: describeLedgerSync(!!row, attempts, POLL_ATTEMPTS),
      componentRow: row,
    };
  },
});
