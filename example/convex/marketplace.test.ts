// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Tests for the BTS-42 marketplace subscription + payout demo's pure helpers
 * (`marketplace.ts`).
 *
 * Same policy as actions.test.ts / seed.ts: the Stripe-calling halves (the
 * destination-charge checkout, the connected-account balance fetch) need a live
 * key and are exercised via the gated Playwright E2E, not here. What IS
 * unit-testable is the money math that turns a Stripe balance snapshot + payout
 * rows into the figures the merged `PayoutSchedule`/`EarningsSummary` components
 * render, and the per-sale platform-fee breakdown shown on the demo.
 *
 * BTS-91 also covers the query handlers that resolve demo context from the
 * BTS-41 seed (`getMarketplaceDemoContext`, `getDestinationChargeDemoContext`,
 * `getLatestStoreInvoice`) — the persona/catalog-matching and null-fallback
 * branches, which previously had zero test coverage.
 */
import { convexTest } from "convex-test";
import { computeFee } from "@fantastic.dev/better-stripe";
import { describe, expect, it } from "vitest";

import { api, components } from "./_generated/api";
import schema from "./schema";
// The installed component, loaded from the built output the example resolves.
import componentSchema from "../../dist/component/schema.js";

import {
  DEMO_FEE_PERCENT,
  reconciles,
  saleBreakdown,
  summarizeStripeBalance,
} from "./marketplace";

const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}

describe("summarizeStripeBalance", () => {
  it("sums available/pending amounts and picks the currency", () => {
    const snap = summarizeStripeBalance({
      available: [{ amount: 4410, currency: "usd" }],
      pending: [{ amount: 1500, currency: "usd" }],
    });
    expect(snap).toEqual({ available: 4410, pending: 1500, currency: "usd" });
  });

  it("collapses multiple entries of the same currency", () => {
    const snap = summarizeStripeBalance({
      available: [
        { amount: 1000, currency: "usd" },
        { amount: 500, currency: "usd" },
      ],
      pending: [],
    });
    expect(snap.available).toBe(1500);
    expect(snap.pending).toBe(0);
    expect(snap.currency).toBe("usd");
  });

  it("defaults currency to usd and amounts to 0 for an empty balance", () => {
    expect(summarizeStripeBalance({ available: [], pending: [] })).toEqual({
      available: 0,
      pending: 0,
      currency: "usd",
    });
  });
});

describe("saleBreakdown", () => {
  it("splits a $49.00 sale into a 10% platform fee and the seller's net", () => {
    // computeFee($49.00, 10%) = $4.90; the seller keeps the remainder.
    expect(saleBreakdown(4900, 10)).toEqual({
      gross: 4900,
      fee: 490,
      net: 4410,
    });
  });

  it("returns a zero fee for a zero-amount invoice", () => {
    expect(saleBreakdown(0, 10)).toEqual({ gross: 0, fee: 0, net: 0 });
  });

  it("splits Sasha's $129.00 one-time price into a 10% fee and net (BTS-58)", () => {
    expect(saleBreakdown(12900, 10)).toEqual({
      gross: 12900,
      fee: 1290,
      net: 11610,
    });
  });
});

describe("reconciles (BTS-58)", () => {
  it("is true when fee + net reconstructs the gross exactly", () => {
    expect(reconciles(saleBreakdown(12900, 10))).toBe(true);
  });

  it("holds across a spread of odd-cent amounts, not just round numbers", () => {
    // Guards the AC's "fee + payout == charge" requirement against a
    // computeFee rounding regression that only shows up on non-round cents.
    for (const amount of [1, 3, 7, 99, 101, 12901, 999999]) {
      expect(reconciles(saleBreakdown(amount, 10))).toBe(true);
    }
  });

  it("is false when the breakdown doesn't add up", () => {
    expect(reconciles({ gross: 12900, fee: 1290, net: 11000 })).toBe(false);
  });

  // BTS-78: the tests above never exercise the reconcile guard against a
  // failure it could actually catch — `saleBreakdown` *defines*
  // `net = gross - fee`, so any breakdown it produces reconciles by
  // construction (the "spread of odd-cent amounts" test above is really
  // testing computeFee's cap-at-amount/non-negativity, not the guard). The
  // guard's actual job is to catch a *different* (and real) computeFee
  // rounding pitfall: computing the fee and the net as two INDEPENDENT
  // roundings of the gross (`round(gross*percent/100)` and
  // `round(gross*(1-percent/100))`) instead of `net = gross - fee`. Each
  // rounds correctly on its own but the pair can overshoot or undershoot the
  // gross by a cent — exactly what `reconciles` exists to catch before a
  // demo displays it.
  it("catches a real double-rounding divergence (fee and net rounded independently) instead of only a hand-built mismatch", () => {
    // ¥101 at 50% is zero-decimal-currency (JPY) safe — computeFee doesn't
    // divide by 100 for minor units, so this is a real amount, not cents.
    const gross = 101;
    const percent = 50;

    // The correct fee, from the actual library function (not hand-picked).
    const fee = computeFee(gross, { percent }).feeAmount;
    expect(fee).toBe(51); // Math.round(101 * 0.5) = 51 (round-half-up)

    // The correct breakdown (net = gross - fee) always reconciles.
    expect(reconciles(saleBreakdown(gross, percent))).toBe(true);

    // The BUGGY alternative a naive implementation might use instead of
    // `net = gross - fee`: round the seller's share directly from the gross.
    // Both individual roundings are "correct" in isolation, but together
    // they overshoot the charge by a cent (51 + 51 = 102 > 101) — the exact
    // class of computeFee rounding regression `reconciles` guards against.
    const naiveNet = Math.round(gross * (1 - percent / 100));
    expect(naiveNet).toBe(51);
    expect(reconciles({ gross, fee, net: naiveNet })).toBe(false);
  });

  it("reconciles a JPY (zero-decimal) computeFee rounding case correctly", () => {
    // ¥1001 at 15% — a fractional percentAmount (150.15) that computeFee
    // rounds half-up to a whole yen, exercised through the real gross/fee/net
    // pipeline for a zero-decimal currency (no /100 minor-unit conversion).
    const breakdown = saleBreakdown(1001, 15);
    expect(breakdown).toEqual({ gross: 1001, fee: 150, net: 851 });
    expect(reconciles(breakdown)).toBe(true);
  });
});

// =============================================================================
// getMarketplaceDemoContext (BTS-91) — persona/catalog resolution + null-fallback
// =============================================================================

describe("getMarketplaceDemoContext", () => {
  it("returns null before the marketplace seed has run (0-persona)", async () => {
    const t = withComponent();

    const result = await t.query(api.marketplace.getMarketplaceDemoContext, {});
    expect(result).toBeNull();
  });

  it("returns null when only the buyer persona is seeded (seller missing)", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
    });

    const result = await t.query(api.marketplace.getMarketplaceDemoContext, {});
    expect(result).toBeNull();
  });

  it("returns null when the seller persona exists but has no linked Stripe account", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        storeName: "Maya's Fitness Studio",
      });
    });

    const result = await t.query(api.marketplace.getMarketplaceDemoContext, {});
    expect(result).toBeNull();
  });

  it("returns null when the store's catalog has no MONTHLY recurring price (only yearly)", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        storeName: "Maya's Fitness Studio",
        stripeAccountId: "acct_maya",
      });
    });
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_maya",
      accountId: "acct_maya",
      name: "Fitness Coaching Membership",
      active: true,
    });
    await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
      stripePriceId: "price_maya_yearly",
      productId: "internal_prod_maya",
      stripeProductId: "prod_maya",
      unitAmount: 49900,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "year",
    });

    const result = await t.query(api.marketplace.getMarketplaceDemoContext, {});
    expect(result).toBeNull();
  });

  it("resolves the buyer, store, and monthly price once the seed has fully run", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        storeName: "Maya's Fitness Studio",
        stripeAccountId: "acct_maya",
      });
    });
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_maya",
      accountId: "acct_maya",
      name: "Fitness Coaching Membership",
      active: true,
    });
    // A non-matching (yearly) price on the same product exercises the
    // handler's `.find` skipping past it to reach the monthly one.
    await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
      stripePriceId: "price_maya_yearly",
      productId: "internal_prod_maya",
      stripeProductId: "prod_maya",
      unitAmount: 49900,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "year",
    });
    await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
      stripePriceId: "price_maya_monthly",
      productId: "internal_prod_maya",
      stripeProductId: "prod_maya",
      unitAmount: 4900,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "month",
    });

    const result = await t.query(api.marketplace.getMarketplaceDemoContext, {});

    expect(result).not.toBeNull();
    expect(result!.buyer).toMatchObject({
      name: "Billie Buyer",
      email: "billie@example.com",
    });
    expect(result!.store).toMatchObject({
      name: "Maya Merchant",
      storeName: "Maya's Fitness Studio",
      stripeAccountId: "acct_maya",
    });
    expect(result!.price).toMatchObject({
      stripePriceId: "price_maya_monthly",
      unitAmount: 4900,
      currency: "usd",
      interval: "month",
    });
    expect(result!.feePercent).toBe(DEMO_FEE_PERCENT);
  });
});

// =============================================================================
// getDestinationChargeDemoContext (BTS-91/BTS-58) — one-time price + fee breakdown
// =============================================================================

describe("getDestinationChargeDemoContext", () => {
  it("returns null before the marketplace seed has run (0-persona)", async () => {
    const t = withComponent();

    const result = await t.query(
      api.marketplace.getDestinationChargeDemoContext,
      {},
    );
    expect(result).toBeNull();
  });

  it("returns null when the seller persona exists but has no linked Stripe account", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
      await ctx.db.insert("users", {
        name: "Sasha Studio",
        email: "sasha@example.com",
        role: "seller",
        storeName: "Sasha's Ceramics",
      });
    });

    const result = await t.query(
      api.marketplace.getDestinationChargeDemoContext,
      {},
    );
    expect(result).toBeNull();
  });

  it("returns null when the store's catalog has no ONE-TIME price (only recurring)", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
      await ctx.db.insert("users", {
        name: "Sasha Studio",
        email: "sasha@example.com",
        role: "seller",
        storeName: "Sasha's Ceramics",
        stripeAccountId: "acct_sasha",
      });
    });
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_sasha",
      accountId: "acct_sasha",
      name: "Ceramics Masterclass",
      active: true,
    });
    await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
      stripePriceId: "price_sasha_monthly",
      productId: "internal_prod_sasha",
      stripeProductId: "prod_sasha",
      unitAmount: 4900,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "month",
    });

    const result = await t.query(
      api.marketplace.getDestinationChargeDemoContext,
      {},
    );
    expect(result).toBeNull();
  });

  it("resolves the buyer, store, one-time price, and fee breakdown once seeded (BTS-58)", async () => {
    const t = withComponent();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
      await ctx.db.insert("users", {
        name: "Sasha Studio",
        email: "sasha@example.com",
        role: "seller",
        storeName: "Sasha's Ceramics",
        stripeAccountId: "acct_sasha",
      });
    });
    await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
      stripeProductId: "prod_sasha",
      accountId: "acct_sasha",
      name: "Ceramics Masterclass",
      active: true,
    });
    await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
      stripePriceId: "price_sasha_lifetime",
      productId: "internal_prod_sasha",
      stripeProductId: "prod_sasha",
      unitAmount: 12900,
      currency: "usd",
      active: true,
      type: "one_time",
    });

    const result = await t.query(
      api.marketplace.getDestinationChargeDemoContext,
      {},
    );

    expect(result).not.toBeNull();
    expect(result!.buyer).toMatchObject({
      name: "Billie Buyer",
      email: "billie@example.com",
    });
    expect(result!.store).toMatchObject({
      name: "Sasha Studio",
      storeName: "Sasha's Ceramics",
      stripeAccountId: "acct_sasha",
    });
    expect(result!.price).toMatchObject({
      stripePriceId: "price_sasha_lifetime",
      unitAmount: 12900,
      currency: "usd",
    });
    expect(result!.feePercent).toBe(DEMO_FEE_PERCENT);
    // Same $129.00 one-time price as the pure saleBreakdown test above.
    expect(result!.breakdown).toEqual({
      gross: 12900,
      fee: 1290,
      net: 11610,
      reconciles: true,
    });
  });
});

// =============================================================================
// getLatestStoreInvoice (BTS-91) — latest PAID invoice + fee breakdown
// =============================================================================

describe("getLatestStoreInvoice", () => {
  it("returns null when the user has no invoices", async () => {
    const t = withComponent();

    const result = await t.query(api.marketplace.getLatestStoreInvoice, {
      userId: "user_billie",
    });
    expect(result).toBeNull();
  });

  it("returns null when the user's only invoice is unpaid", async () => {
    const t = withComponent();
    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_open",
      userId: "user_billie",
      status: "open",
      currency: "usd",
      amountDue: 4900,
      amountPaid: 0,
    });

    const result = await t.query(api.marketplace.getLatestStoreInvoice, {
      userId: "user_billie",
    });
    expect(result).toBeNull();
  });

  it("returns the most recent PAID invoice among several, with the fee/net breakdown", async () => {
    const t = withComponent();

    // Oldest: paid.
    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_first",
      userId: "user_billie",
      status: "paid",
      currency: "usd",
      amountDue: 4900,
      amountPaid: 4900,
    });
    // Middle: unpaid, so it must be skipped even though it's more recent than
    // the first invoice.
    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_failed",
      userId: "user_billie",
      status: "open",
      currency: "usd",
      amountDue: 4900,
      amountPaid: 0,
    });
    // Newest: paid — this is the one the handler should surface.
    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_latest",
      userId: "user_billie",
      status: "paid",
      currency: "usd",
      amountDue: 4900,
      amountPaid: 4900,
    });

    const result = await t.query(api.marketplace.getLatestStoreInvoice, {
      userId: "user_billie",
    });

    expect(result).toEqual({
      stripeInvoiceId: "in_latest",
      gross: 4900,
      fee: 490,
      net: 4410,
      currency: "usd",
    });
  });

  it("does not leak another user's invoice as the latest", async () => {
    const t = withComponent();
    await t.mutation(components.betterStripe.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "in_other_user",
      userId: "user_jordan",
      status: "paid",
      currency: "usd",
      amountDue: 9900,
      amountPaid: 9900,
    });

    const result = await t.query(api.marketplace.getLatestStoreInvoice, {
      userId: "user_billie",
    });
    expect(result).toBeNull();
  });
});
