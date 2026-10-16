import { describe, expect, it } from "vitest";
import { STORE_PLANS, hasPaidStorePlan, settleStoreSale } from "./helpers";

describe("seller store plans", () => {
  it("offers the requested monthly prices and inclusive selling fees", () => {
    expect(STORE_PLANS.map((p) => [p.monthlyAmount, p.feeBasisPoints])).toEqual(
      [
        [900, 900],
        [4900, 490],
        [9900, null],
      ],
    );
  });
  it("requires an active paid billing period, without granting access for an unpaid selection", () => {
    expect(hasPaidStorePlan(undefined, 100)).toBe(false);
    expect(
      hasPaidStorePlan({ status: "incomplete", paidThrough: 200 }, 100),
    ).toBe(false);
    expect(hasPaidStorePlan({ status: "active", paidThrough: 100 }, 100)).toBe(
      false,
    );
    expect(hasPaidStorePlan({ status: "active", paidThrough: 200 }, 100)).toBe(
      true,
    );
    expect(
      hasPaidStorePlan({ status: "past_due", paidThrough: 200 }, 100),
    ).toBe(false);
  });
  it.each([
    ["starter", 900, 580, 9100],
    ["growth", 490, 170, 9510],
    ["pro", 320, 0, 9680],
  ] as const)(
    "settles %s without adding Stripe processing fees twice",
    (planId, sellingFee, platformNet, sellerNet) => {
      expect(
        settleStoreSale({
          gross: 10000,
          processingFee: 320,
          planId,
          referred: false,
        }),
      ).toEqual({
        gross: 10000,
        processingFee: 320,
        sellingFee,
        platformNet,
        sellerNet,
        affiliateNet: 0,
      });
    },
  );
  it("uses the actual processing charge for Pro, including international-card costs", () => {
    expect(
      settleStoreSale({
        gross: 10000,
        processingFee: 570,
        planId: "pro",
        referred: false,
      }).sellerNet,
    ).toBe(9430);
  });
  it("passes processing above the percentage floor to the seller without a platform subsidy", () => {
    expect(
      settleStoreSale({
        gross: 100,
        processingFee: 33,
        planId: "starter",
        referred: false,
      }),
    ).toMatchObject({ sellingFee: 33, sellerNet: 67, platformNet: 0 });
  });
  it.each(["starter", "growth", "pro"] as const)(
    "reconciles every cent of a referred sale on %s",
    (planId) => {
      const sale = settleStoreSale({
        gross: 12900,
        processingFee: 404,
        planId,
        referred: true,
        affiliateBasisPoints: 2000,
      });
      expect(
        sale.sellerNet +
          sale.affiliateNet +
          sale.processingFee +
          sale.platformNet,
      ).toBe(12900);
      expect(sale.affiliateNet).toBe(
        Math.floor((sale.gross - sale.sellingFee) * 0.2),
      );
    },
  );
  it("refuses missing or invalid actual fee data", () => {
    expect(() =>
      settleStoreSale({
        gross: 10000,
        processingFee: NaN,
        planId: "pro",
        referred: false,
      }),
    ).toThrow();
    expect(() =>
      settleStoreSale({
        gross: 10000,
        processingFee: -1,
        planId: "pro",
        referred: false,
      }),
    ).toThrow();
  });
});

it("uses configured sale fees while keeping the Stripe processing floor and exact splits", () => {
  expect(
    settleStoreSale({
      gross: 10000,
      processingFee: 320,
      planId: "starter",
      feeBasisPoints: 750,
      affiliateBasisPoints: 2000,
      referred: true,
    }),
  ).toMatchObject({
    sellingFee: 750,
    platformNet: 430,
    affiliateNet: 1850,
    sellerNet: 7400,
  });
  expect(
    settleStoreSale({
      gross: 10000,
      processingFee: 320,
      planId: "starter",
      feeBasisPoints: 100,
      referred: false,
    }),
  ).toMatchObject({ sellingFee: 320, platformNet: 0, sellerNet: 9680 });
  expect(
    settleStoreSale({
      gross: 10000,
      processingFee: 320,
      planId: "growth",
      feeBasisPoints: null,
      referred: true,
    }).platformNet,
  ).toBe(0);
});

it.each([
  ["starter", 1000, 910, 8190],
  ["growth", 2500, 2377, 7133],
  ["pro", 3500, 3388, 6292],
] as const)(
  "applies the configured affiliate rate on %s after sale fees",
  (planId, affiliateBasisPoints, affiliateNet, sellerNet) => {
    const sale = settleStoreSale({
      gross: 10000,
      processingFee: 320,
      planId,
      referred: true,
      affiliateBasisPoints,
    });
    expect(sale).toMatchObject({ affiliateNet, sellerNet });
    expect(
      sale.processingFee +
        sale.platformNet +
        sale.affiliateNet +
        sale.sellerNet,
    ).toBe(10000);
  },
);
it("supports zero and full affiliate shares, ignores direct sales, and rejects invalid rates", () => {
  const base = {
    gross: 10000,
    processingFee: 320,
    planId: "growth" as const,
    referred: true,
  };
  expect(
    settleStoreSale({ ...base, affiliateBasisPoints: 0 }).affiliateNet,
  ).toBe(0);
  expect(
    settleStoreSale({ ...base, affiliateBasisPoints: 10000 }),
  ).toMatchObject({ affiliateNet: 9510, sellerNet: 0 });
  expect(
    settleStoreSale({ ...base, affiliateBasisPoints: 10000, referred: false })
      .affiliateNet,
  ).toBe(0);
  for (const rate of [-1, 10001, 12.5])
    expect(() =>
      settleStoreSale({ ...base, affiliateBasisPoints: rate }),
    ).toThrow(/affiliate/i);
});
