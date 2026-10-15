import { expect, it } from "vitest";
import { stripeCostDeficit } from "./lib/sellerCosts";
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
