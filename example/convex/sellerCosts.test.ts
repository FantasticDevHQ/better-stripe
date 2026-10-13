import { expect, it } from "vitest";
import { stripeCostDeficit, allocateSellerCosts } from "./lib/sellerCosts";
it("passes non-refundable processing on a full refund back to the seller", () => {
  expect(
    stripeCostDeficit({
      gross: 10000,
      sellingFee: 900,
      processingFee: 320,
      principalReturned: 10000,
      disputeFees: 0,
    }),
  ).toBe(320);
});
it("does not bill processing twice when the inclusive fee still covers it after a partial refund", () => {
  expect(
    stripeCostDeficit({
      gross: 10000,
      sellingFee: 900,
      processingFee: 320,
      principalReturned: 1000,
      disputeFees: 0,
    }),
  ).toBe(0);
  expect(
    stripeCostDeficit({
      gross: 10000,
      sellingFee: 320,
      processingFee: 320,
      principalReturned: 1000,
      disputeFees: 0,
    }),
  ).toBe(32);
});
it("includes actual dispute costs and removes returned costs when Stripe credits them", () => {
  expect(
    stripeCostDeficit({
      gross: 10000,
      sellingFee: 490,
      processingFee: 320,
      principalReturned: 10000,
      disputeFees: 1500,
    }),
  ).toBe(1820);
  expect(
    stripeCostDeficit({
      gross: 10000,
      sellingFee: 490,
      processingFee: 320,
      principalReturned: 0,
      disputeFees: 0,
    }),
  ).toBe(0);
});
it("deducts only what a seller can earn now and carries the remainder for billing", () => {
  expect(allocateSellerCosts([500, 300], 600, 100)).toEqual({
    recovery: 600,
    allocations: [500, 100],
  });
  expect(allocateSellerCosts([500], 0, 100)).toEqual({
    recovery: 0,
    allocations: [0],
  });
});
it("nets credits against debts and caps extra credits to the charge's transfer headroom", () => {
  expect(allocateSellerCosts([1000, -900], 50, 100)).toEqual({
    recovery: 50,
    allocations: [950, -900],
  });
  expect(allocateSellerCosts([-500], 1000, 100)).toEqual({
    recovery: -100,
    allocations: [-100],
  });
});
