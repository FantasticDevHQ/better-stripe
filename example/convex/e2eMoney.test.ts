import { describe, expect, it } from "vitest";

import { reconcilesToCharge } from "./e2eMoney";

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
