import { env } from "../_generated/server";

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

import { v } from "convex/values";

import { action } from "../_generated/server";

import { assertTestModeStripeKey } from "../users/authorization";

import { stripe } from "../stripe/helpers";
import {
  ADMIN_TEST_PAYMENT_AMOUNT,
  POLL_ATTEMPTS,
  describeLedgerSync,
  getMarketplaceDemoContextRef,
  getPaymentRowRef,
  pollForLedgerRow,
  rawStripe,
  requireDemoAccounts,
} from "./helpers";

// ─── Account Updated ──────────────────────────────────────────────────────

/**
 * Real `v2.core.accounts.update` metadata bump on the seeded store account —
 * fires a genuine `v2.core.account.updated` thin event. Metadata-only, so
 * it's safe to click repeatedly without disturbing the account's onboarding
 * state or capabilities.
 */
export const fireAccountUpdated = action({
  args: {},
  returns: v.object({
    stripeAccountId: v.string(),
    pingedAt: v.string(),
    ledgerSync: v.string(),
    componentRow: v.any(),
  }),
  handler: async (ctx) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const { storeAccountId } = await requireDemoAccounts(ctx);
    const pingedAt = new Date().toISOString();

    await stripe.updateV2Account(ctx, {
      stripeAccountId: storeAccountId,
      updateParams: { metadata: { bsAdminTestPing: pingedAt } },
    });

    const { row, attempts } = await pollForLedgerRow(
      () =>
        stripe.getAccountByStripeId(ctx, { stripeAccountId: storeAccountId }),
      (row) => row.metadata?.bsAdminTestPing === pingedAt,
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
  returns: v.object({
    stripeSubscriptionId: v.string(),
    pingedAt: v.string(),
    ledgerSync: v.string(),
    componentRow: v.any(),
  }),
  handler: async (ctx) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
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

    const { row, attempts } = await pollForLedgerRow(
      () =>
        stripe.getSubscriptionByStripeId(ctx, {
          stripeSubscriptionId: active.stripeSubscriptionId,
        }),
      (row) => row.metadata?.bsAdminTestPing === pingedAt,
    );

    return {
      stripeSubscriptionId: active.stripeSubscriptionId,
      pingedAt,
      ledgerSync: describeLedgerSync(!!row, attempts, POLL_ATTEMPTS),
      componentRow: row,
    };
  },
});
// $5.00 — small, fixed, test-mode only.

/**
 * A real, immediately-confirmed one-time PaymentIntent against the seeded
 * store (destination charge) — mirrors `e2eMoney.ts`'s `e2eDestinationFeeSale`
 * driver. Fires genuine `payment_intent.succeeded` / `charge.succeeded`
 * events. Creates a fresh, isolated Stripe object each click — never mutates
 * existing demo state.
 */
export const fireCheckoutCompleted = action({
  args: {},
  returns: v.object({
    stripePaymentIntentId: v.string(),
    status: v.string(),
    amount: v.number(),
    ledgerSync: v.string(),
    componentRow: v.any(),
  }),
  handler: async (ctx) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
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
 * pays using a fresh attached sandbox Visa, selected explicitly on the new
 * subscription, firing a genuine `invoice.paid` event.
 * Creates a fresh, isolated subscription each click — never mutates an
 * existing subscription.
 */
export const fireInvoicePaid = action({
  args: {},
  returns: v.object({
    stripeSubscriptionId: v.string(),
    subscriptionStatus: v.string(),
    ledgerSync: v.string(),
    componentRow: v.any(),
  }),
  handler: async (ctx) => {
    assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
    const { storeAccountId, buyerUserId, buyerAccountId } =
      await requireDemoAccounts(ctx);

    const context = await ctx.runQuery(getMarketplaceDemoContextRef, {});
    if (!context) {
      throw new Error(
        "Marketplace demo context not seeded — run `npm run setup` first.",
      );
    }

    // Each trigger gets its own attached sandbox card; existing buyer defaults
    // and subscriptions are left alone. The test-mode guard runs first.
    const raw = rawStripe();
    const paymentMethod = await raw.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await raw.paymentMethods.attach(paymentMethod.id, {
      customer_account: buyerAccountId,
    });

    const sub = await stripe.createSubscription(ctx, {
      userId: buyerUserId,
      customerAccount: buyerAccountId,
      defaultPaymentMethod: paymentMethod.id,
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
