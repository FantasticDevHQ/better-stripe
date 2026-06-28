import { describe, expect, it } from "vitest";

import { resolveFeeConfig, validatePlatformFee } from "./fees.js";

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
