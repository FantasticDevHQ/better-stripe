import { describe, expect, it } from "vitest";

import { reversalsMatchExactly } from "../scripts/money-assertions";
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

/**
 * BTS-73: the refund/dispute checks must assert the EXACT pro-rata reversed
 * amount per recipient, not just `reversedAmount > 0`. A partial or missing
 * reversal has to fail the gate, so this exact-match predicate is what turns a
 * "landed but wrong" reversal into a hard FAIL.
 */
describe("reversalsMatchExactly (BTS-73 exact reversal assertion)", () => {
  const EXPECTED = { store: 8_000, affiliate: 1_000 };

  it("matches when every leg is reversed to exactly its expected amount", () => {
    expect(
      reversalsMatchExactly(
        [
          { role: "store", reversedAmount: 8_000 },
          { role: "affiliate", reversedAmount: 1_000 },
        ],
        EXPECTED,
      ),
    ).toBe(true);
  });

  it("does NOT match a partial reversal (affiliate under-reversed)", () => {
    expect(
      reversalsMatchExactly(
        [
          { role: "store", reversedAmount: 8_000 },
          { role: "affiliate", reversedAmount: 500 },
        ],
        EXPECTED,
      ),
    ).toBe(false);
  });

  it("does NOT match when a leg was not reversed at all (0)", () => {
    expect(
      reversalsMatchExactly(
        [
          { role: "store", reversedAmount: 8_000 },
          { role: "affiliate", reversedAmount: 0 },
        ],
        EXPECTED,
      ),
    ).toBe(false);
  });

  it("does NOT match when a leg reversed MORE than expected", () => {
    expect(
      reversalsMatchExactly(
        [
          { role: "store", reversedAmount: 9_000 },
          { role: "affiliate", reversedAmount: 1_000 },
        ],
        EXPECTED,
      ),
    ).toBe(false);
  });

  it("does NOT match a missing leg", () => {
    expect(
      reversalsMatchExactly([{ role: "store", reversedAmount: 8_000 }], EXPECTED),
    ).toBe(false);
  });

  it("does NOT match an unexpected extra leg", () => {
    expect(
      reversalsMatchExactly(
        [
          { role: "store", reversedAmount: 8_000 },
          { role: "affiliate", reversedAmount: 1_000 },
          { role: "other", reversedAmount: 500 },
        ],
        EXPECTED,
      ),
    ).toBe(false);
  });

  it("treats a missing reversedAmount as 0 (not reversed)", () => {
    expect(
      reversalsMatchExactly(
        [{ role: "store", reversedAmount: 8_000 }, { role: "affiliate" }],
        EXPECTED,
      ),
    ).toBe(false);
  });
});
