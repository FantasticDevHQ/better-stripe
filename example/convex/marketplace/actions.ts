import { env } from "../_generated/server";

import Stripe from "stripe";

import { v } from "convex/values";

import { action } from "../_generated/server";

import { stripe } from "../stripe/helpers";
import {
  assertAccountOwner,
  assertPriceSoldByAccount,
} from "../users/authorization";
import {
  type BalanceSnapshot,
  checkoutSessionResultValidator,
  DEMO_FEE_PERCENT,
  STRIPE_API_VERSION,
  summarizeStripeBalance,
} from "./model";

// ===========================================================================
// Actions — Stripe-calling (live key required; exercised via gated E2E)
// ===========================================================================

/**
 * Create an embedded checkout session for the buyer to subscribe to the store's
 * recurring plan as a destination charge, with the platform's 10% application
 * fee. `mode: "subscription"` with no trial means the first invoice charges
 * immediately — a real charge, not a trial.
 */
export const createStoreSubscriptionCheckout = action({
  args: {
    userId: v.string(),
    stripePriceId: v.string(),
    destinationAccountId: v.string(),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await assertPriceSoldByAccount(ctx, args);
    return stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: "subscription",
      returnUrl: args.returnUrl,
      uiMode: "embedded",
      destinationAccountId: args.destinationAccountId,
      // Percent-only override so the fee rides on `application_fee_percent` and
      // lands on the first invoice (see file header).
      fee: { percent: DEMO_FEE_PERCENT },
    });
  },
});

/**
 * Create an embedded checkout session for the buyer to purchase the
 * store's one-time price as a destination charge, with the platform's 10%
 * application fee. The server-owned price amount computes a
 * fixed `application_fee_amount` at session-creation time — no per-charge
 * webhook step needed, unlike the fixed/tiered default.
 */
export const createDestinationChargeCheckout = action({
  args: {
    requestId: v.optional(v.string()),
    userId: v.string(),
    stripePriceId: v.string(),
    destinationAccountId: v.string(),
    returnUrl: v.string(),
  },
  returns: checkoutSessionResultValidator,
  handler: async (ctx, args) => {
    const price = await assertPriceSoldByAccount(ctx, args);
    if (
      !price.active ||
      price.type !== "one_time" ||
      !Number.isSafeInteger(price.unitAmount) ||
      price.unitAmount <= 0
    ) {
      throw new Error(
        "Destination checkout requires an active fixed one-time price.",
      );
    }
    return stripe.createCheckoutSession(ctx, {
      idempotencyKey: args.requestId
        ? `destination_${args.userId}_${args.requestId}`
        : undefined,
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: "payment",
      returnUrl: args.returnUrl,
      uiMode: "embedded",
      destinationAccountId: args.destinationAccountId,
      amount: price.unitAmount,
      fee: { percent: DEMO_FEE_PERCENT },
    });
  },
});

/**
 * Read a connected account's live Stripe balance (available/pending) so the
 * seller dashboard reflects funds from the destination transfer before the
 * rolling payout lands. Returns `null` without a live key or if Stripe rejects
 * the read, so the demo degrades to payouts-only rather than erroring. Throws
 * when `userId` is not linked to `stripeAccountId`.
 */
export const getRecipientBalance = action({
  args: { userId: v.string(), stripeAccountId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      available: v.number(),
      pending: v.number(),
      currency: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<BalanceSnapshot | null> => {
    // Ownership is checked outside the degrade-to-null path below: a foreign
    // account is a refusal, not a "balance unavailable".
    await assertAccountOwner(ctx, args);
    if (!env.STRIPE_SECRET_KEY) return null;
    try {
      const raw = new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: STRIPE_API_VERSION,
      });
      const balance = await raw.balance.retrieve(
        {},
        { stripeAccount: args.stripeAccountId },
      );
      return summarizeStripeBalance({
        available: balance.available,
        pending: balance.pending,
      });
    } catch (err) {
      console.warn(
        `[bts-42] balance read failed for ${args.stripeAccountId}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },
});
