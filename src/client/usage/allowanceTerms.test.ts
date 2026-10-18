import { expect, it } from "vitest";
import {
  allowanceBinding,
  allowanceStatus,
  limitPolicy,
} from "./allowanceTerms.js";
import { request } from "./subscription.fixtures.js";
const original = {
  ...request.meters[0],
  subscription: {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: { start: 600, end: 1200 },
    interval: "month",
  },
};
it("calculates fractional units and decimal minor-currency estimates without rounding", () => {
  const binding = allowanceBinding({
    ...original,
    binding: {
      ...original.binding,
      plan: {
        ...original.binding.plan,
        unit: { name: "call", precision: 2 },
        includedQuantity: "1.25",
        rate: { currency: "usd", unitAmountDecimal: "0.025" },
      },
    },
  });
  const policy = limitPolicy(
    {
      reset: "billing_period",
      rollover: "none",
      entitled: true,
      overage: "allow",
      limit: { mode: "soft", quantity: "1.30" },
    },
    binding,
  );
  expect(
    allowanceStatus(
      binding,
      policy,
      { consumed: "130", reserved: "1", revision: 1 },
      700,
    ),
  ).toMatchObject({
    consumedQuantity: "1.3",
    reservedQuantity: "0.01",
    billableOverageQuantity: "0.05",
    softLimitReached: true,
    committedEstimate: { amountDecimal: "0.00125", currency: "usd" },
    projectedEstimate: { amountDecimal: "0.0015", currency: "usd" },
  });
});
it("rejects unsupported rollover/reset, invalid precision and prepaid instead of minting allowance credit", () => {
  const binding = allowanceBinding(original),
    policy = {
      reset: "billing_period",
      rollover: "none",
      entitled: true,
      overage: "allow",
      limit: { mode: "none" },
    };
  for (const changed of [
    { ...policy, reset: "calendar_month" },
    { ...policy, rollover: "carry" },
    { ...policy, limit: { mode: "hard", quantity: "0.1" } },
    { ...policy, limit: { mode: "hard", quantity: "1000000000000000000" } },
  ])
    expect(() => limitPolicy(changed, binding)).toThrow();
  expect(() =>
    allowanceBinding({
      ...original,
      binding: {
        ...original.binding,
        plan: {
          key: "calls",
          version: "v1",
          model: "prepaid",
          unit: { name: "call", precision: 0 },
          rate: { currency: "usd", unitAmountDecimal: "2" },
          insufficientBalance: "reject",
        },
      },
    }),
  ).toThrow(/payment-backed/i);
});
it("supports optional pay-as-you-go hard caps without inventing included units", () => {
  const binding = allowanceBinding({
    ...original,
    binding: {
      ...original.binding,
      plan: {
        key: "calls",
        version: "v1",
        model: "pay_as_you_go",
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
  });
  const policy = limitPolicy(
    {
      reset: "billing_period",
      rollover: "none",
      entitled: true,
      overage: "allow",
      limit: { mode: "hard", quantity: "12" },
    },
    binding,
  );
  expect(
    allowanceStatus(
      binding,
      policy,
      { consumed: "6", reserved: "6", revision: 1 },
      700,
    ),
  ).toMatchObject({
    includedQuantity: "0",
    hardLimitRemainingQuantity: "0",
    accepting: false,
    committedEstimate: { amountDecimal: "12", currency: "usd" },
    projectedEstimate: { amountDecimal: "24", currency: "usd" },
  });
  expect(() => limitPolicy({ ...policy, overage: "reject" }, binding)).toThrow(
    /explicit usage cap/i,
  );
});
