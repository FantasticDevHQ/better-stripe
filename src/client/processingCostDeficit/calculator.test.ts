import { describe, expect, it } from "vitest";
import {
  calculateProcessingCostDeficit,
  type ProcessingCostDeficitOptions,
} from "./index.js";

const original: ProcessingCostDeficitOptions = {
  currency: "usd",
  gross: 10000,
  sellingFee: 900,
  processingFee: 320,
  principalReturned: 10000,
  disputeFees: 0,
  liability: { processingCosts: "uncovered", disputeCosts: "all" },
  rounding: "nearest",
};

describe("explicit processing cost liability", () => {
  it("passes uncovered costs on a full return under the host-selected policy", () => {
    expect(calculateProcessingCostDeficit(original)).toEqual({
      currency: "usd",
      retainedFee: 0,
      processingLiability: 320,
      disputeLiability: 0,
      amountDue: 320,
    });
  });
  it.each(["usd", "jpy", "isk", "ugx"])(
    "matches historical integer-unit rounding for ordinary %s values",
    (currency) => {
      for (const principalReturned of [0, 1, 1000, 5000, 9999, 10000, 12000]) {
        for (const sellingFee of [0, 320, 490, 900]) {
          const retainedFee = Math.round(
            (sellingFee * (10000 - Math.min(10000, principalReturned))) / 10000,
          );
          const result = calculateProcessingCostDeficit({
            ...original,
            currency,
            principalReturned,
            sellingFee,
            disputeFees: 1500,
          });
          expect(result.retainedFee).toBe(retainedFee);
          expect(result.amountDue).toBe(Math.max(0, 320 - retainedFee) + 1500);
        }
      }
    },
  );
  it("lets the host retain all liability instead of assuming a seller pays", () => {
    expect(
      calculateProcessingCostDeficit({
        ...original,
        disputeFees: 1500,
        liability: { processingCosts: "none", disputeCosts: "none" },
      }),
    ).toMatchObject({
      processingLiability: 0,
      disputeLiability: 0,
      amountDue: 0,
    });
  });
  it("supports all processing costs with an independent dispute policy", () => {
    expect(
      calculateProcessingCostDeficit({
        ...original,
        principalReturned: 0,
        disputeFees: 1500,
        liability: { processingCosts: "all", disputeCosts: "none" },
      }),
    ).toMatchObject({
      retainedFee: 900,
      processingLiability: 320,
      amountDue: 320,
    });
  });
  it.each([
    ["nearest", 5, 0],
    ["floor", 4, 1],
    ["ceil", 5, 0],
  ] as const)(
    "uses the selected %s rounding for retained fee",
    (rounding, retainedFee, amountDue) => {
      expect(
        calculateProcessingCostDeficit({
          ...original,
          gross: 10,
          sellingFee: 5,
          processingFee: 5,
          principalReturned: 1,
          rounding,
        }),
      ).toMatchObject({ retainedFee, amountDue });
    },
  );
  it("does not lose a unit when an intermediate product exceeds safe integer precision", () => {
    expect(
      calculateProcessingCostDeficit({
        ...original,
        gross: 9007199254740991,
        sellingFee: 9007199254740990,
        principalReturned: 3002399751580330,
        processingFee: 6004799503160661,
      }),
    ).toMatchObject({ retainedFee: 6004799503160660, amountDue: 1 });
  });
  it("caps overlapping returned principal at original gross and includes actual dispute costs", () => {
    expect(
      calculateProcessingCostDeficit({
        ...original,
        principalReturned: 20000,
        disputeFees: 1500,
      }),
    ).toMatchObject({ retainedFee: 0, amountDue: 1820 });
  });
  it("normalizes currency codes without converting any ledger units", () => {
    expect(
      calculateProcessingCostDeficit({ ...original, currency: "USD" }).currency,
    ).toBe("usd");
  });
});

describe("invalid financial inputs", () => {
  it.each([null, undefined])(
    "rejects an absent options object %s",
    (options) => {
      expect(() =>
        calculateProcessingCostDeficit(
          options as unknown as ProcessingCostDeficitOptions,
        ),
      ).toThrow(RangeError);
    },
  );
  it.each([
    "gross",
    "sellingFee",
    "processingFee",
    "principalReturned",
    "disputeFees",
  ] as const)("rejects invalid %s values", (field) => {
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        calculateProcessingCostDeficit({ ...original, [field]: value }),
      ).toThrow(RangeError);
    }
  });
  it.each([
    { gross: 0 },
    { sellingFee: 10001 },
    { currency: "unknown" },
    { currency: "kwd" },
    { rounding: "random" },
    { liability: { processingCosts: "seller", disputeCosts: "all" } },
    { liability: { processingCosts: "uncovered", disputeCosts: "seller" } },
    { liability: undefined },
    { rounding: undefined },
  ])(
    "rejects missing/unsupported currency, policy or amount combinations %j",
    (invalid) => {
      expect(() =>
        calculateProcessingCostDeficit({
          ...original,
          ...invalid,
        } as ProcessingCostDeficitOptions),
      ).toThrow(RangeError);
    },
  );
  it("rejects an unrepresentable total even when each input is a safe integer", () => {
    expect(() =>
      calculateProcessingCostDeficit({
        ...original,
        processingFee: Number.MAX_SAFE_INTEGER,
        disputeFees: 1,
      }),
    ).toThrow(RangeError);
  });
});
