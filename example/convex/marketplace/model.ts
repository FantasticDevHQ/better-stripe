import Stripe from "stripe";

import { computeFee } from "@fantastic.dev/better-stripe";

import { v } from "convex/values";

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
export type StripeApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"]
>;

export const STRIPE_API_VERSION: StripeApiVersion = "2026-09-30.endive";

/** The platform's demo fee: a flat 10% application fee on the destination charge. */
export const DEMO_FEE_PERCENT = 10;

// ===========================================================================
// Pure money helpers (unit-tested in marketplace.test.ts)
// ===========================================================================

export type BalanceEntry = { amount: number; currency: string };

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

/**
 * BTS-58: verify a sale breakdown's fee + net reconstructs the gross exactly.
 * Enforced before the destination-charge-with-fee demo displays its
 * breakdown, so a `computeFee` rounding regression would show a visible
 * warning instead of silently shipping a receipt that doesn't add up.
 */
export function reconciles(breakdown: {
  gross: number;
  fee: number;
  net: number;
}): boolean {
  return breakdown.fee + breakdown.net === breakdown.gross;
}

// ===========================================================================
// Queries — resolve the demo personas and the store's money surfaces
// ===========================================================================

export const demoContextValidator = v.union(
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

export const destinationChargeDemoContextValidator = v.union(
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
    }),
    feePercent: v.number(),
    breakdown: v.object({
      gross: v.number(),
      fee: v.number(),
      net: v.number(),
      reconciles: v.boolean(),
    }),
  }),
);

export const checkoutSessionResultValidator = v.object({
  stripeSessionId: v.string(),
  clientSecret: v.optional(v.string()),
  url: v.optional(v.string()),
});
