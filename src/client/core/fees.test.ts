import { describe, expect, it } from "vitest";

import {
  computeFee,
  computeSplit,
  resolveFeeConfig,
  validatePlatformFee,
} from "./fees.js";

describe("validatePlatformFee (BTS-13)", () => {
  it("accepts a percent-only config", () => {
    expect(() => validatePlatformFee({ percent: 10 })).not.toThrow();
  });

  it("accepts percent + fixed", () => {
    expect(() => validatePlatformFee({ percent: 2.9, fixed: 30 })).not.toThrow();
  });

  it("accepts ascending tiers with a null final upper bound", () => {
    expect(() =>
      validatePlatformFee({
        percent: 2.9,
        fixed: 30,
        tiers: [
          { upTo: 89900, percent: 2.9, fixed: 30 },
          { upTo: null, percent: 3.9, fixed: 30 },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects percent > 100", () => {
    expect(() => validatePlatformFee({ percent: 150 })).toThrow();
  });

  it("rejects negative percent", () => {
    expect(() => validatePlatformFee({ percent: -1 })).toThrow();
  });

  it("rejects negative fixed", () => {
    expect(() => validatePlatformFee({ percent: 5, fixed: -30 })).toThrow();
  });

  it("rejects non-ascending / overlapping tiers", () => {
    expect(() =>
      validatePlatformFee({
        percent: 2.9,
        tiers: [
          { upTo: 89900, percent: 2.9 },
          { upTo: 50000, percent: 3.9 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a null upper bound that is not last", () => {
    expect(() =>
      validatePlatformFee({
        percent: 2.9,
        tiers: [
          { upTo: null, percent: 2.9 },
          { upTo: 89900, percent: 3.9 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a tier with an out-of-range percent", () => {
    expect(() =>
      validatePlatformFee({
        percent: 2.9,
        tiers: [{ upTo: null, percent: 200 }],
      }),
    ).toThrow();
  });

  it("rejects a fractional fixed amount (minor units must be whole)", () => {
    expect(() => validatePlatformFee({ percent: 5, fixed: 0.5 })).toThrow(
      /integer/i,
    );
  });

  it("rejects a fractional tier upper bound", () => {
    expect(() =>
      validatePlatformFee({
        percent: 2.9,
        tiers: [{ upTo: 89900.25, percent: 2.9 }],
      }),
    ).toThrow(/integer/i);
  });
});

describe("resolveFeeConfig precedence (BTS-13)", () => {
  it("returns the per-call override when provided", () => {
    const def = { percent: 10 };
    const override = { percent: 20 };
    expect(resolveFeeConfig(def, override)).toEqual({ percent: 20 });
  });

  it("falls back to the default when no override", () => {
    const def = { percent: 10 };
    expect(resolveFeeConfig(def, undefined)).toEqual({ percent: 10 });
  });

  it("returns undefined when neither is set", () => {
    expect(resolveFeeConfig(undefined, undefined)).toBeUndefined();
  });

  it("validates the override config (override bypasses the constructor)", () => {
    expect(() => resolveFeeConfig({ percent: 10 }, { percent: 150 })).toThrow(
      /platformFee/,
    );
  });
});

describe("computeFee (BTS-14)", () => {
  it("computes a percent-only fee", () => {
    expect(computeFee(10000, { percent: 10 }).feeAmount).toBe(1000);
  });

  it("computes percent + fixed (2.9% + 30¢)", () => {
    // round(10000 * 0.029) + 30 = 290 + 30 = 320
    expect(computeFee(10000, { percent: 2.9, fixed: 30 }).feeAmount).toBe(320);
  });

  it("applies fixed-only when percent is 0", () => {
    expect(computeFee(10000, { percent: 0, fixed: 30 }).feeAmount).toBe(30);
  });

  it("returns a full breakdown", () => {
    const r = computeFee(10000, { percent: 2.9, fixed: 30 });
    expect(r).toMatchObject({
      feeAmount: 320,
      percentApplied: 2.9,
      fixedApplied: 30,
    });
  });

  it("selects the low tier below the boundary", () => {
    const cfg = {
      percent: 2.9,
      tiers: [
        { upTo: 89900, percent: 2.9, fixed: 30 },
        { upTo: null, percent: 3.9, fixed: 30 },
      ],
    };
    const r = computeFee(50000, cfg);
    expect(r.percentApplied).toBe(2.9);
    expect(r.feeAmount).toBe(Math.round(50000 * 0.029) + 30); // 1450 + 30
  });

  it("treats the tier upper bound as inclusive", () => {
    const cfg = {
      percent: 2.9,
      tiers: [
        { upTo: 89900, percent: 2.9, fixed: 30 },
        { upTo: null, percent: 3.9, fixed: 30 },
      ],
    };
    expect(computeFee(89900, cfg).percentApplied).toBe(2.9);
  });

  it("selects the high (catch-all) tier above the boundary", () => {
    const cfg = {
      percent: 2.9,
      tiers: [
        { upTo: 89900, percent: 2.9, fixed: 30 },
        { upTo: null, percent: 3.9, fixed: 30 },
      ],
    };
    const r = computeFee(90000, cfg);
    expect(r.percentApplied).toBe(3.9);
    expect(r.tier).toMatchObject({ upTo: null, percent: 3.9 });
  });

  it("returns zero fee for a zero amount (e.g. a trial with no charge)", () => {
    expect(computeFee(0, { percent: 10, fixed: 30 }).feeAmount).toBe(0);
  });

  it("returns zero fee for a negative amount (defensive)", () => {
    expect(computeFee(-500, { percent: 10 }).feeAmount).toBe(0);
  });

  it("rounds half-up", () => {
    // 50 * 1% = 0.5 → 1
    expect(computeFee(50, { percent: 1 }).feeAmount).toBe(1);
  });

  it("rounds down below the half", () => {
    // 49 * 1% = 0.49 → 0
    expect(computeFee(49, { percent: 1 }).feeAmount).toBe(0);
  });

  it("never produces a fee greater than the amount", () => {
    // 100% + 50 fixed would be 150; capped to the charge amount.
    expect(computeFee(100, { percent: 100, fixed: 50 }).feeAmount).toBe(100);
  });

  it("caps fixedApplied consistently when the fee hits the amount cap", () => {
    // percent already consumes the whole amount, so no fixed can be collected.
    const r = computeFee(100, { percent: 100, fixed: 50 });
    expect(r.feeAmount).toBe(100);
    expect(r.fixedApplied).toBe(0);
    // partial fixed: 90 (90%) + 50 fixed → capped at 100, so only 10 of fixed fits.
    const r2 = computeFee(100, { percent: 90, fixed: 50 });
    expect(r2.feeAmount).toBe(100);
    expect(r2.fixedApplied).toBe(10);
  });

  it("handles large amounts without float drift", () => {
    // $100,000.00 = 10,000,000 minor units; 3% = $3,000.00 = 300,000 minor units.
    expect(computeFee(100_000_00, { percent: 3 }).feeAmount).toBe(300_000);
  });
});

describe("computeSplit (BTS-23)", () => {
  const store = "acct_store";
  const aff = "acct_aff";

  it("splits with fixed recipient amounts; platform retains the rest", () => {
    const r = computeSplit(
      10000,
      { percent: 10 },
      [
        { destinationAccountId: store, role: "store", amount: 8000 },
        { destinationAccountId: aff, role: "affiliate", amount: 1000 },
      ],
    );
    expect(r.transfers).toEqual([
      { destinationAccountId: store, role: "store", amount: 8000 },
      { destinationAccountId: aff, role: "affiliate", amount: 1000 },
    ]);
    expect(r.platformFee).toBe(1000); // 10% configured cut
    expect(r.platformRetained).toBe(1000); // 10000 - 9000
    // invariant: transfers + platform retention == gross
    const sum = r.transfers.reduce((s, t) => s + t.amount, 0);
    expect(sum + r.platformRetained).toBe(10000);
  });

  it("supports percent-of-gross recipients", () => {
    const r = computeSplit(
      10000,
      { percent: 10 },
      [
        { destinationAccountId: store, role: "store", percent: 80 },
        { destinationAccountId: aff, role: "affiliate", percent: 5 },
      ],
    );
    expect(r.transfers.map((t) => t.amount)).toEqual([8000, 500]);
    expect(r.platformRetained).toBe(1500); // 10000 - 8500
  });

  it("never emits an application fee (separate charges & transfers)", () => {
    const r = computeSplit(10000, { percent: 10 }, [
      { destinationAccountId: store, role: "store", amount: 9000 },
    ]);
    expect(r).not.toHaveProperty("applicationFeeAmount");
    expect(r).not.toHaveProperty("applicationFeePercent");
  });

  it("rejects a split whose transfers + platform fee exceed the charge", () => {
    expect(() =>
      computeSplit(10000, { percent: 10 }, [
        { destinationAccountId: store, role: "store", amount: 9500 }, // 9500 + 1000 fee > 10000
      ]),
    ).toThrow();
  });

  it("assigns the rounding remainder deterministically to the platform", () => {
    // 33% + 33% + 33% of 100 → 33 + 33 + 33 = 99; platform keeps the 1 remainder.
    const r = computeSplit(
      100,
      undefined,
      [
        { destinationAccountId: store, role: "store", percent: 33 },
        { destinationAccountId: aff, role: "affiliate", percent: 33 },
        { destinationAccountId: "acct_c", role: "other", percent: 33 },
      ],
    );
    const sum = r.transfers.reduce((s, t) => s + t.amount, 0);
    expect(sum).toBe(99);
    expect(r.platformRetained).toBe(1);
    expect(sum + r.platformRetained).toBe(100);
  });

  it("with no fee config the whole amount is distributable", () => {
    const r = computeSplit(10000, undefined, [
      { destinationAccountId: store, role: "store", amount: 10000 },
    ]);
    expect(r.platformFee).toBe(0);
    expect(r.platformRetained).toBe(0);
  });

  it("returns zeros for a non-positive amount", () => {
    const r = computeSplit(0, { percent: 10 }, [
      { destinationAccountId: store, role: "store", amount: 100 },
    ]);
    expect(r.transfers).toEqual([]);
    expect(r.platformFee).toBe(0);
    expect(r.platformRetained).toBe(0);
  });
})
