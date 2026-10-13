import { describe, expect, it } from "vitest";
import {
  STORE_PLANS,
  hasPaidStorePlan,
  settleStoreSale,
} from "./lib/storePlans";

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
