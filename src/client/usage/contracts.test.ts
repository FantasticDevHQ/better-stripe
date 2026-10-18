import { expect, it } from "vitest";
import { defineUsagePlan, parseUsageQuantity } from "./contracts.js";

const base = {
  key: "api_requests",
  version: "v1",
  unit: { name: "request", precision: 3 },
  rate: { currency: "usd", unitAmountDecimal: "0.02" },
};
it.each([
  { ...base, model: "pay_as_you_go" },
  {
    ...base,
    model: "included_overage",
    includedQuantity: "1000",
    reset: "billing_period",
  },
  { ...base, model: "prepaid", insufficientBalance: "reject" },
])("validates a serializable plan for $model", (input) => {
  expect(defineUsagePlan(input)).toEqual(input);
  expect(JSON.parse(JSON.stringify(defineUsagePlan(input)))).toEqual(input);
});
it("rejects invalid or ambiguous model configuration", () => {
  for (const input of [
    { ...base, model: "unknown" },
    { ...base, model: "pay_as_you_go", includedQuantity: "5" },
    {
      ...base,
      model: "included_overage",
      includedQuantity: "1.0001",
      reset: "billing_period",
    },
    { ...base, model: "prepaid", insufficientBalance: "allow" },
    { ...base, model: "prepaid" },
    {
      ...base,
      model: "pay_as_you_go",
      rate: { currency: "USD", unitAmountDecimal: "0.1" },
    },
    {
      ...base,
      model: "pay_as_you_go",
      rate: { currency: "usd", unitAmountDecimal: 0.1 },
    },
  ])
    expect(() => defineUsagePlan(input)).toThrow();
});
it("represents exact quantities beyond JavaScript's safe integer range", () => {
  expect(parseUsageQuantity("9007199254740993.01", 2)).toEqual({
    quantity: "9007199254740993.01",
    scaledQuantity: "900719925474099301",
    precision: 2,
  });
  expect(parseUsageQuantity("1.2300", 4)).toEqual({
    quantity: "1.23",
    scaledQuantity: "12300",
    precision: 4,
  });
  expect(parseUsageQuantity("0.000", 3)).toEqual({
    quantity: "0",
    scaledQuantity: "0",
    precision: 3,
  });
});
it("rejects rounding, noncanonical numbers, excessive precision and unsafe input", () => {
  for (const value of [
    "-1",
    "+1",
    "1e3",
    "01",
    "1.",
    ".1",
    " 1",
    "1.0001",
    "NaN",
    1,
    Infinity,
    null,
  ])
    expect(() => parseUsageQuantity(value, 3)).toThrow();
  for (const precision of [-1, 1.5, 7, NaN])
    expect(() => parseUsageQuantity("1", precision)).toThrow();
  expect(() => parseUsageQuantity("1000000000000000000", 0)).toThrow();
});
it("copies configuration so caller mutation cannot change validated terms", () => {
  const input = {
    ...base,
    unit: { ...base.unit },
    rate: { ...base.rate },
    model: "pay_as_you_go",
  };
  const plan = defineUsagePlan(input);
  input.rate.unitAmountDecimal = "999";
  expect(plan.rate.unitAmountDecimal).toBe("0.02");
});

it("keeps event identity scoped and independent of plan revisions", async () => {
  const { prepareUsageRecord } = await import("./records.js");
  const input = {
    scope: {
      stripeAccountId: "acct_platform",
      customerAccount: "acct_buyer",
      meterId: "mtr_requests",
      livemode: false,
    },
    binding: {
      stripeCustomerId: "cus_mapped",
      eventName: "requests_v1",
      stripePriceId: "price_requests",
      plan: { ...base, model: "pay_as_you_go" },
    },
    sourceEventId: "job_123",
    quantity: "1.230",
    occurredAt: 1000,
  };
  const first = prepareUsageRecord(input);
  expect(first.quantity).toBe("1.23");
  expect(first.scaledQuantity).toBe("1230");
  expect(
    prepareUsageRecord({
      ...input,
      binding: {
        ...input.binding,
        plan: { ...input.binding.plan, version: "v2" },
      },
    }).identity,
  ).toBe(first.identity);
  expect(
    prepareUsageRecord({
      ...input,
      scope: { ...input.scope, customerAccount: "acct_other" },
    }).identity,
  ).not.toBe(first.identity);
  expect(
    prepareUsageRecord({ ...input, scope: { ...input.scope, livemode: true } })
      .identity,
  ).not.toBe(first.identity);
  expect(() => prepareUsageRecord({ ...input, occurredAt: 1.5 })).toThrow();
  expect(() =>
    prepareUsageRecord({
      ...input,
      binding: { ...input.binding, stripeCustomerId: "acct_buyer" },
    }),
  ).toThrow();
});
