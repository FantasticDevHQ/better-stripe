import { expect, it } from "vitest";
import { creditPurchaseTerms, creditCost } from "./creditTerms.js";
import { meter } from "./subscription.fixtures.js";
const input = {
  ...meter,
  binding: {
    ...meter.binding,
    plan: {
      key: "calls",
      version: "v1",
      model: "prepaid",
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
      insufficientBalance: "reject",
    },
  },
  purchaseId: "topup1",
  quantity: "50",
  ownership: "issuer",
  rollover: "retain_original_terms",
};
it("pins original prepaid unit/payment terms and computes exact integer backing", () => {
  const terms = creditPurchaseTerms(input);
  expect(terms.amount).toBe(100);
  expect(creditCost(terms.binding.plan, "15")).toBe(30);
});
it("rejects third-party wallets, fractional monetary backing and invalid quantities", () => {
  expect(() =>
    creditPurchaseTerms({ ...input, ownership: "seller" }),
  ).toThrow();
  expect(() => creditPurchaseTerms({ ...input, quantity: "0" })).toThrow();
  expect(() =>
    creditPurchaseTerms({
      ...input,
      binding: {
        ...input.binding,
        plan: {
          ...input.binding.plan,
          rate: { currency: "usd", unitAmountDecimal: "0.1" },
        },
      },
      quantity: "1",
    }),
  ).toThrow(/whole minor/i);
  expect(() =>
    creditPurchaseTerms({ ...input, quantity: "50000000" }),
  ).toThrow();
});
