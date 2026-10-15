import { describe, expect, it } from "vitest";

import {
  formatChargeAmount,
  getChargeCurrencyMetadata,
  parseChargeAmount,
} from "./charge-currency.js";

describe("charge currency units", () => {
  it.each([
    ["USD", "10.05", 1005, 2, 2],
    ["jpy", "500", 500, 0, 0],
    ["mga", "500", 500, 0, 0],
    ["isk", "500", 50000, 2, 0],
    ["ugx", "500", 50000, 2, 0],
    ["huf", "10.45", 1045, 2, 2],
    ["twd", "800.45", 80045, 2, 2],
    ["afn", "1.25", 125, 2, 2],
  ])(
    "parses %s using charge rules",
    (currency, decimal, units, apiDecimals, displayDecimals) => {
      expect(getChargeCurrencyMetadata(currency)).toEqual({
        currency: currency.toLowerCase(),
        apiDecimals,
        displayDecimals,
      });
      expect(parseChargeAmount(decimal, currency)).toBe(units);
      const parts = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: displayDecimals,
        maximumFractionDigits: displayDecimals,
      }).format(Number(decimal));
      expect(formatChargeAmount(units, currency)).toBe(parts);
    },
  );

  it.each(["ZZZ", "", "usd ", "BHD", "CLF"])(
    "rejects unknown or unsupported precision %s",
    (currency) => {
      expect(getChargeCurrencyMetadata(currency)).toBeNull();
      expect(parseChargeAmount("1", currency)).toBeNull();
      expect(() => formatChargeAmount(100, currency)).toThrow(RangeError);
    },
  );

  it.each([
    ["", "usd"],
    ["1e2", "usd"],
    ["1,000", "usd"],
    ["-1", "usd"],
    ["1.005", "usd"],
    ["0.5", "jpy"],
    ["0.5", "mga"],
    ["1.01", "isk"],
    ["1.01", "ugx"],
    ["90071992547409.92", "usd"],
  ])("rejects invalid decimal %s %s without rounding", (decimal, currency) => {
    expect(parseChargeAmount(decimal, currency)).toBeNull();
  });

  it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid provider units %s",
    (amount) => {
      expect(() => formatChargeAmount(amount, "usd")).toThrow(RangeError);
    },
  );

  it("rejects fractional compatibility units", () => {
    expect(() => formatChargeAmount(101, "isk")).toThrow(RangeError);
    expect(() => formatChargeAmount(101, "ugx")).toThrow(RangeError);
  });

  it("keeps the final minor unit at the safe integer boundary", () => {
    expect(formatChargeAmount(-1, "usd")).toBe("-$0.01");
    expect(formatChargeAmount(-Number.MAX_SAFE_INTEGER, "usd")).toBe(
      "-$90,071,992,547,409.91",
    );
    expect(parseChargeAmount("90071992547409.91", "usd")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(formatChargeAmount(Number.MAX_SAFE_INTEGER, "usd")).toBe(
      "$90,071,992,547,409.91",
    );
    expect(formatChargeAmount(0, "usd")).toBe("$0.00");
    expect(parseChargeAmount("0", "usd")).toBe(0);
  });

  it("localizes grouping and digits without losing provider precision", () => {
    expect(formatChargeAmount(123456, "eur", "de-DE")).toBe("1.234,56 €");
    expect(formatChargeAmount(125, "usd", "ar-EG")).toContain("١٫٢٥");
  });
});
