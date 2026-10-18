import { expect, it } from "vitest";
import { assertUsageReplay, validateUsagePageRequest } from "./boundaries.js";
import { prepareUsageRecord } from "./records.js";
import { authorizeUsageRecord, type UsageAuthorization } from "./boundaries.js";

const event = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "pay_as_you_go",
      unit: { name: "call", precision: 2 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
    },
  },
  sourceEventId: "request_1",
  quantity: "1.20",
  occurredAt: 100,
};
it("bounds page requests and uses half-open explicit periods", () => {
  expect(
    validateUsagePageRequest({
      period: { start: 0, end: 100 },
      limit: 100,
      cursor: null,
    }),
  ).toEqual({ period: { start: 0, end: 100 }, limit: 100, cursor: null });
  for (const input of [
    { period: { start: 0, end: 0 }, limit: 10, cursor: null },
    { period: { start: 10, end: 9 }, limit: 10, cursor: null },
    { period: { start: 0, end: 1.1 }, limit: 10, cursor: null },
    { period: { start: 0, end: 100 }, limit: 101, cursor: null },
    { period: { start: 0, end: 100 }, limit: 0, cursor: null },
    { period: { start: 0, end: 100 }, limit: 10, cursor: "x".repeat(2049) },
  ])
    expect(() => validateUsagePageRequest(input)).toThrow();
});
it("accepts an exact replay after normalizing quantities", () => {
  expect(() =>
    assertUsageReplay(
      prepareUsageRecord(event),
      prepareUsageRecord({ ...event, quantity: "1.2" }),
    ),
  ).not.toThrow();
});
it("rejects replay changes to historical terms, routing, time or quantity", () => {
  const original = prepareUsageRecord(event);
  for (const changed of [
    { ...event, quantity: "1.21" },
    { ...event, occurredAt: 101 },
    { ...event, binding: { ...event.binding, stripeCustomerId: "cus_other" } },
    {
      ...event,
      binding: {
        ...event.binding,
        plan: { ...event.binding.plan, version: "v2" },
      },
    },
    {
      ...event,
      binding: {
        ...event.binding,
        plan: {
          ...event.binding.plan,
          rate: { currency: "eur", unitAmountDecimal: "2" },
        },
      },
    },
  ])
    expect(() =>
      assertUsageReplay(original, prepareUsageRecord(changed)),
    ).toThrow("Conflicting usage replay");
});

it("runs host authorization and activity policy before accepting any model", async () => {
  const order: string[] = [];
  const policy: UsageAuthorization<{ userId: string }> = {
    async authorize(ctx, request) {
      expect(ctx.userId).toBe("user_1");
      expect(request.operation).toBe("record");
      order.push("authorize");
    },
    async authorizeActivity() {
      order.push("activity");
    },
  };
  for (const plan of [
    event.binding.plan,
    {
      ...event.binding.plan,
      model: "included_overage",
      includedQuantity: "10",
      reset: "billing_period",
    },
    { ...event.binding.plan, model: "prepaid", insufficientBalance: "reject" },
  ]) {
    await authorizeUsageRecord(
      { userId: "user_1" },
      policy,
      { ...event, binding: { ...event.binding, plan } },
      async (record) => {
        order.push("accept");
        return record.identity;
      },
    );
  }
  expect(order).toEqual(
    Array(3).fill(["authorize", "activity", "accept"]).flat(),
  );
  order.length = 0;
  await expect(
    authorizeUsageRecord(
      { userId: "user_1" },
      {
        ...policy,
        async authorizeActivity() {
          throw new Error("Not billable");
        },
      },
      event,
      async () => {
        order.push("accept");
      },
    ),
  ).rejects.toThrow("Not billable");
  expect(order).toEqual(["authorize"]);
});
