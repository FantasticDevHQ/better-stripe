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
 */
import { describe, expect, it } from "vitest";

import { saleBreakdown, summarizeStripeBalance } from "./marketplace";

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
});
