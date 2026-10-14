import { describe, expect, it } from "vitest";
import { settleStoreSale } from "./storePlans";
describe("fixed affiliate payouts", () => {
  const sale = {
    gross: 10000,
    processingFee: 320,
    planId: "starter" as const,
    referred: true,
  };
  it("pays a fixed amount in the sale currency after fees", () => {
    expect(
      settleStoreSale({ ...sale, affiliateFixedAmount: 12.5, currency: "eur" }),
    ).toMatchObject({ affiliateNet: 1250, sellerNet: 7850, platformNet: 580 });
  });
  it("caps fixed payouts at proceeds and skips unreferred sales", () => {
    expect(
      settleStoreSale({ ...sale, affiliateFixedAmount: 200 }).sellerNet,
    ).toBe(0);
    expect(
      settleStoreSale({ ...sale, affiliateFixedAmount: 200, referred: false })
        .affiliateNet,
    ).toBe(0);
  });
  it("uses zero-decimal currencies and rejects invalid amounts", () => {
    expect(
      settleStoreSale({ ...sale, affiliateFixedAmount: 500, currency: "jpy" })
        .affiliateNet,
    ).toBe(500);
    expect(() =>
      settleStoreSale({ ...sale, affiliateFixedAmount: -1 }),
    ).toThrow();
    expect(() =>
      settleStoreSale({ ...sale, affiliateFixedAmount: 1.001 }),
    ).toThrow();
  });
});
