import { describe, expect, it } from "vitest";

import {
  filterPricesByInterval,
  formatPrice,
  formatPriceWithInterval,
  sortPricesByAmount,
} from "./price-helpers.js";

describe("formatPrice", () => {
  it("formats USD cents to dollars", () => {
    expect(formatPrice(2000, "usd")).toBe("$20.00");
  });

  it("formats zero", () => {
    expect(formatPrice(0, "usd")).toBe("$0.00");
  });

  it("handles fractional cents", () => {
    expect(formatPrice(999, "usd")).toBe("$9.99");
  });

  it("formats EUR", () => {
    const result = formatPrice(1500, "eur", "de-DE");
    expect(result).toContain("15");
  });

  it("uppercases currency code", () => {
    expect(formatPrice(100, "usd")).toBe("$1.00");
    expect(formatPrice(100, "USD")).toBe("$1.00");
  });
});

describe("formatPriceWithInterval", () => {
  it("shows amount only for one_time prices", () => {
    const result = formatPriceWithInterval({
      unitAmount: 2900,
      currency: "usd",
      type: "one_time",
      interval: null,
      intervalCount: null,
      active: true,
    });
    expect(result).toBe("$29.00");
  });

  it("appends /month for monthly recurring", () => {
    const result = formatPriceWithInterval({
      unitAmount: 1900,
      currency: "usd",
      type: "recurring",
      interval: "month",
      intervalCount: 1,
      active: true,
    });
    expect(result).toBe("$19.00/month");
  });

  it("appends /year for annual recurring", () => {
    const result = formatPriceWithInterval({
      unitAmount: 18900,
      currency: "usd",
      type: "recurring",
      interval: "year",
      intervalCount: 1,
      active: true,
    });
    expect(result).toBe("$189.00/year");
  });

  it("shows 'every N intervals' for multi-interval", () => {
    const result = formatPriceWithInterval({
      unitAmount: 5000,
      currency: "usd",
      type: "recurring",
      interval: "month",
      intervalCount: 3,
      active: true,
    });
    expect(result).toBe("$50.00 every 3 months");
  });

  it("handles null unitAmount as zero", () => {
    const result = formatPriceWithInterval({
      unitAmount: null,
      currency: "usd",
      type: "one_time",
      interval: null,
      intervalCount: null,
      active: true,
    });
    expect(result).toBe("$0.00");
  });
});

describe("filterPricesByInterval", () => {
  const prices = [
    {
      unitAmount: 1000,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      type: "recurring",
      active: true,
    },
    {
      unitAmount: 10000,
      currency: "usd",
      interval: "year",
      intervalCount: 1,
      type: "recurring",
      active: true,
    },
    {
      unitAmount: 500,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      type: "recurring",
      active: false,
    },
  ];

  it("filters by month", () => {
    const result = filterPricesByInterval(prices, "month");
    expect(result).toHaveLength(1);
    expect(result[0].unitAmount).toBe(1000);
  });

  it("filters by year", () => {
    const result = filterPricesByInterval(prices, "year");
    expect(result).toHaveLength(1);
    expect(result[0].unitAmount).toBe(10000);
  });

  it("excludes inactive prices", () => {
    const result = filterPricesByInterval(prices, "month");
    expect(result.every((p) => p.active)).toBe(true);
  });

  it("returns empty array for null/undefined input", () => {
    expect(filterPricesByInterval(null, "month")).toEqual([]);
    expect(filterPricesByInterval(undefined, "month")).toEqual([]);
  });

  it("returns empty for unmatched interval", () => {
    expect(filterPricesByInterval(prices, "week")).toEqual([]);
  });
});

describe("sortPricesByAmount", () => {
  it("sorts ascending by unitAmount", () => {
    const prices = [
      {
        unitAmount: 5000,
        currency: "usd",
        type: "one_time",
        active: true,
      },
      {
        unitAmount: 1000,
        currency: "usd",
        type: "one_time",
        active: true,
      },
      {
        unitAmount: 3000,
        currency: "usd",
        type: "one_time",
        active: true,
      },
    ];
    const sorted = sortPricesByAmount(prices);
    expect(sorted.map((p) => p.unitAmount)).toEqual([1000, 3000, 5000]);
  });

  it("does not mutate original array", () => {
    const prices = [
      { unitAmount: 2000, currency: "usd", type: "one_time", active: true },
      { unitAmount: 1000, currency: "usd", type: "one_time", active: true },
    ];
    sortPricesByAmount(prices);
    expect(prices[0].unitAmount).toBe(2000);
  });

  it("treats null unitAmount as 0", () => {
    const prices = [
      { unitAmount: 1000, currency: "usd", type: "one_time", active: true },
      { unitAmount: null, currency: "usd", type: "one_time", active: true },
    ];
    const sorted = sortPricesByAmount(prices);
    expect(sorted[0].unitAmount).toBeNull();
  });

  it("returns empty array for null/undefined input", () => {
    expect(sortPricesByAmount(null)).toEqual([]);
    expect(sortPricesByAmount(undefined)).toEqual([]);
  });
});
