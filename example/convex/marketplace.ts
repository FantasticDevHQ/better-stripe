import Stripe from "stripe";
import { computeFee } from "@getdojo/better-stripe";
import { v } from "convex/values";

import { action, query } from "./_generated/server";
import { stripe } from "./stripe";

/**
 * BTS-42 — real paid subscription + payout/balance visibility demo (M7).
 *
 * A buyer subscribes to a seeded store's recurring plan as a **destination
 * charge**: the platform is merchant of record, funds route to the seller's
 * connected account, and the platform keeps its fee. The seller then sees the
 * money land via their balance + rolling payouts, and the platform fee is
 * surfaced on the resulting invoice.
 *
 * Why a per-call `fee: { percent: 10 }` override (not the tiered platform
 * default configured in stripe.ts): a percent-only fee rides on Stripe's
 * `application_fee_percent`, which applies to every invoice including the first
 * with no extra webhook work, and gives the demo a clean, deterministic 10% fee
 * to display. (The fixed/tiered default now also collects on the first invoice
 * as of BTS-68; percent-only is just the simplest shape for this demo.)
 *
 * As with seed.ts/actions.ts, the Stripe-calling halves (checkout, balance)
 * need a live key and are exercised by the gated Playwright E2E; the pure money
 * math below is unit-tested (marketplace.test.ts).
 */

// Match the API version the BetterStripe client pins (see seed.ts), so the raw
// client used for the connected-account balance read speaks the same dialect.
type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;
const STRIPE_API_VERSION: StripeApiVersion = "2026-05-27.dahlia";

/** The platform's demo fee: a flat 10% application fee on the destination charge. */
export const DEMO_FEE_PERCENT = 10;

// ===========================================================================
// Pure money helpers (unit-tested in marketplace.test.ts)
// ===========================================================================

type BalanceEntry = { amount: number; currency: string };

/** A recipient's Stripe balance snapshot, collapsed to single amounts (minor units). */
export type BalanceSnapshot = {
  available: number;
  pending: number;
  currency: string;
};

/**
 * Collapse a Stripe balance object (per-currency `available`/`pending` arrays)
 * into single available/pending totals. The seeded demo is single-currency, so
 * amounts are summed and the currency is taken from the first entry.
 */
export function summarizeStripeBalance(balance: {
  available: BalanceEntry[];
  pending: BalanceEntry[];
}): BalanceSnapshot {
  const sum = (rows: BalanceEntry[]) => rows.reduce((s, r) => s + r.amount, 0);
  const currency =
    balance.available[0]?.currency ?? balance.pending[0]?.currency ?? "usd";
  return {
    available: sum(balance.available),
    pending: sum(balance.pending),
    currency,
  };
}

/**
 * Split a paid invoice amount into the platform fee (via the library's
 * `computeFee`, the same math the engine applied) and the seller's net. Shown on
 * the demo so the platform fee is legible on the resulting invoice.
 */
export function saleBreakdown(
  amountPaid: number,
  feePercent: number,
): { gross: number; fee: number; net: number } {
  const fee = computeFee(amountPaid, { percent: feePercent }).feeAmount;
  return { gross: amountPaid, fee, net: amountPaid - fee };
}

// ===========================================================================
// Queries — resolve the demo personas and the store's money surfaces
// ===========================================================================

const demoContextValidator = v.union(
  v.null(),
  v.object({
    buyer: v.object({ id: v.string(), name: v.string(), email: v.string() }),
    store: v.object({
      sellerId: v.string(),
      name: v.string(),
      storeName: v.string(),
      stripeAccountId: v.string(),
    }),
    price: v.object({
      stripePriceId: v.string(),
      unitAmount: v.number(),
      currency: v.string(),
      interval: v.optional(v.string()),
    }),
    feePercent: v.number(),
  }),
);

/**
 * Resolve everything the demo needs from the BTS-41 seed: the buyer (Billie),
 * the store seller (Maya's Fitness Studio) with her connected account, and that
 * store's monthly recurring price. Returns `null` until the marketplace seed has
 * run and linked accounts + catalog (so the demo pages can show a "seed first"
 * state instead of crashing).
 */
export const getMarketplaceDemoContext = query({
  args: {},
  returns: demoContextValidator,
  handler: async (ctx) => {
    const buyer = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "billie@example.com"))
      .first();
    const seller = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "maya@example.com"))
      .first();
    if (!buyer || !seller?.stripeAccountId) return null;

    const products = await stripe.listProducts(ctx, {
      accountId: seller.stripeAccountId,
    });
    for (const product of products) {
      const prices = await stripe.listPricesByProduct(ctx, {
        stripeProductId: product.stripeProductId,
      });
      const monthly = prices.find(
        (p) => p.type === "recurring" && p.interval === "month",
      );
      if (monthly) {
        return {
          buyer: { id: buyer._id, name: buyer.name, email: buyer.email },
          store: {
            sellerId: seller._id,
            name: seller.name,
            storeName: seller.storeName ?? seller.name,
            stripeAccountId: seller.stripeAccountId,
          },
          price: {
            stripePriceId: monthly.stripePriceId,
            unitAmount: monthly.unitAmount ?? 0,
            currency: monthly.currency,
            interval: monthly.interval ?? undefined,
          },
          feePercent: DEMO_FEE_PERCENT,
        };
      }
    }
    return null;
  },
});

/** The store's payout rows (Connect `listPayouts`, scoped to the recipient account). */
export const listStorePayouts = query({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) =>
    stripe.listPayouts(ctx, { stripeAccountId: args.stripeAccountId }),
});

/**
 * The buyer's latest paid invoice for the store subscription, plus the platform
 * fee split for it. This is the "resulting invoice" the destination charge
 * produced; `saleBreakdown` derives the 10% application fee from the recorded
 * `amountPaid` (the component doesn't denormalize `application_fee_amount` onto
 * the invoice row for the percent path, so the fee is computed from the applied
 * rate — the same value Stripe took).
 */
export const getLatestStoreInvoice = query({
  args: { userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      stripeInvoiceId: v.string(),
      gross: v.number(),
      fee: v.number(),
      net: v.number(),
      currency: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const invoices = await stripe.listInvoices(ctx, { userId: args.userId });
    const paid = invoices
      .filter((i) => i.status === "paid" && i.amountPaid > 0)
      .sort((a, b) => b._creationTime - a._creationTime);
    const latest = paid[0];
    if (!latest) return null;
    const { gross, fee, net } = saleBreakdown(
      latest.amountPaid,
      DEMO_FEE_PERCENT,
    );
    return {
      stripeInvoiceId: latest.stripeInvoiceId,
      gross,
      fee,
      net,
      currency: latest.currency,
    };
  },
});

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
  handler: async (ctx, args) =>
    stripe.createCheckoutSession(ctx, {
      userId: args.userId,
      stripePriceId: args.stripePriceId,
      mode: "subscription",
      returnUrl: args.returnUrl,
      uiMode: "embedded",
      destinationAccountId: args.destinationAccountId,
      // Percent-only override so the fee rides on `application_fee_percent` and
      // lands on the first invoice (see file header).
      fee: { percent: DEMO_FEE_PERCENT },
    }),
});

/**
 * Read a connected account's live Stripe balance (available/pending) so the
 * seller dashboard reflects funds from the destination transfer before the
 * rolling payout lands. Returns `null` without a live key or if Stripe rejects
 * the read, so the demo degrades to payouts-only rather than erroring.
 */
export const getRecipientBalance = action({
  args: { stripeAccountId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      available: v.number(),
      pending: v.number(),
      currency: v.string(),
    }),
  ),
  handler: async (_ctx, args): Promise<BalanceSnapshot | null> => {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    try {
      const raw = new Stripe(process.env.STRIPE_SECRET_KEY, {
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
