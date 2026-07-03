import { describe, expect, it } from "vitest";

import { fullRefundReversalPlan, reconcilesToCharge } from "./e2eMoney";

/**
 * The money assertions in the e2e:webhooks harness (BTS-49) hinge on one
 * invariant — a marketplace sale reconciles when the recipient cuts plus the
 * platform remainder equal the charge. The live driving needs Stripe + a
 * deployment, but this reconciliation check is pure and unit-tested here.
 */
describe("reconcilesToCharge (BTS-49 money assertions)", () => {
  it("reconciles the headline $100 → $80 store + $10 affiliate + $10 platform", () => {
    // Recipients take $90; the platform keeps the $10 remainder.
    expect(reconcilesToCharge(10_000, [8_000, 1_000])).toBe(true);
  });

  it("reconciles a single-recipient sale (platform keeps the fee)", () => {
    expect(reconcilesToCharge(10_000, [9_000])).toBe(true);
  });

  it("reconciles exactly when recipients take the whole charge (zero platform)", () => {
    expect(reconcilesToCharge(10_000, [8_000, 2_000])).toBe(true);
  });

  it("does NOT reconcile when recipient cuts exceed the charge (negative platform)", () => {
    expect(reconcilesToCharge(10_000, [8_000, 3_000])).toBe(false);
  });

  it("handles the empty-split (platform-direct) case", () => {
    expect(reconcilesToCharge(10_000, [])).toBe(true);
  });
});

/**
 * BTS-66: live-verified against Stripe (test mode, 2026-07-03) — a FULL refund
 * with `reverse_transfer: true` of a destination charge whose transfer was
 * already partially reversed (the BTS-60 `bs_pcfee` fee collection) does NOT
 * error; Stripe CAPS the refund-driven reversal at the remaining reversible
 * amount. This helper encodes the expected post-refund transfer state the
 * harness asserts.
 */
describe("fullRefundReversalPlan (BTS-66 cap expectation)", () => {
  it("caps the refund reversal at the remainder after the fee reversal", () => {
    // The probe scenario: $100 transfer, $3.20 fee already reversed → the full
    // refund reverses the remaining $96.80 and the transfer ends fully reversed.
    expect(fullRefundReversalPlan(10_000, 320)).toEqual({
      refundReversal: 9_680,
      totalReversed: 10_000,
    });
  });

  it("reverses the full transfer when no fee was collected", () => {
    expect(fullRefundReversalPlan(10_000, 0)).toEqual({
      refundReversal: 10_000,
      totalReversed: 10_000,
    });
  });

  it("adds no refund reversal to an already fully-reversed transfer", () => {
    expect(fullRefundReversalPlan(10_000, 10_000)).toEqual({
      refundReversal: 0,
      totalReversed: 10_000,
    });
  });
});
