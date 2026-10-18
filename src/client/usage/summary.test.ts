import { expect, it } from "vitest";
import { summarizeUsageRecords } from "./summary.js";
import { prepareUsageRecord } from "./records.js";
const scope = {
  stripeAccountId: "acct_platform",
  customerAccount: "acct_buyer",
  meterId: "mtr_calls",
  livemode: false,
};
const period = { start: 600, end: 1200 };
const subscription = {
  subscriptionId: "sub_calls",
  subscriptionItemId: "si_calls",
  stripePriceId: "price_calls",
  period,
  interval: "month" as const,
};
function view(model = "pay_as_you_go", quantity = "1.25", currency = "usd") {
  const record = prepareUsageRecord({
    scope,
    binding: {
      stripeCustomerId: "cus_buyer",
      stripePriceId: "price_calls",
      eventName: "calls",
      plan: {
        key: "calls",
        version: "v1",
        model,
        unit: { name: "call", precision: 2 },
        rate: { currency, unitAmountDecimal: "2" },
        ...(model === "included_overage"
          ? { includedQuantity: "1", reset: "billing_period" }
          : model === "prepaid"
            ? { insufficientBalance: "reject" }
            : {}),
      },
    },
    sourceEventId: "one",
    quantity,
    occurredAt: 700,
  });
  return {
    record,
    subscription,
    delivery: "provider_accepted" as const,
    hasValidationError: false,
  };
}
it("keeps exact accepted and transport-accepted quantities and separate currencies", () => {
  const local = summarizeUsageRecords(
    [
      view(),
      {
        ...view("pay_as_you_go", "2.5", "eur"),
        record: {
          ...view("pay_as_you_go", "2.5", "eur").record,
          binding: {
            ...view("pay_as_you_go", "2.5", "eur").record.binding,
            stripeCustomerId: "cus_eur",
          },
        },
        delivery: "queued",
      },
    ],
    { period, complete: true, observedAt: 1201 },
  );
  expect(local).toMatchObject({
    complete: true,
    eventCount: 2,
    groups: [
      {
        acceptedQuantity: "1.25",
        providerAcceptedQuantity: "1.25",
        estimate: {
          status: "available",
          value: { amountDecimal: "2.5", currency: "usd" },
        },
      },
      {
        acceptedQuantity: "2.5",
        providerAcceptedQuantity: "0",
        estimate: {
          status: "available",
          value: { amountDecimal: "5", currency: "eur" },
        },
      },
    ],
  });
});
it("applies included units only to a complete original billing period", () => {
  expect(
    summarizeUsageRecords([view("included_overage")], {
      period,
      complete: true,
      observedAt: 1201,
    }),
  ).toMatchObject({
    groups: [
      {
        included: {
          status: "available",
          value: { consumed: "1.25", remaining: "0", overage: "0.25" },
        },
        estimate: { status: "available", value: { amountDecimal: "0.5" } },
      },
    ],
  });
  expect(
    summarizeUsageRecords([view("included_overage")], {
      period: { start: 700, end: 900 },
      complete: true,
      observedAt: 1201,
    }),
  ).toMatchObject({
    groups: [
      {
        included: { status: "unavailable", reason: "partial_billing_period" },
        estimate: { status: "unavailable" },
      },
    ],
  });
});
it("does not fabricate prepaid balances or complete estimates from incomplete history", () => {
  expect(
    summarizeUsageRecords([view("prepaid")], {
      period,
      complete: true,
      observedAt: 1201,
    }),
  ).toMatchObject({
    groups: [
      {
        credits: {
          status: "unavailable",
          reason: "credit_accounting_not_configured",
        },
        estimate: { status: "unavailable" },
      },
    ],
  });
  expect(
    summarizeUsageRecords([view()], {
      period,
      complete: false,
      observedAt: 1201,
    }),
  ).toMatchObject({
    complete: false,
    groups: [
      {
        estimate: { status: "unavailable", reason: "local_history_incomplete" },
      },
    ],
  });
});

it("does not estimate invoice usage across overlapping native subscription items", () => {
  const first = view(),
    second = {
      ...view(),
      subscription: { ...subscription, subscriptionItemId: "si_other" },
    };
  const result = summarizeUsageRecords([first, second], {
    period,
    complete: true,
    observedAt: 1201,
  });
  expect(
    result.groups.every(
      (group) =>
        group.estimate.status === "unavailable" &&
        group.estimate.reason === "ambiguous_subscription_binding",
    ),
  ).toBe(true);
});

it("withholds allowance estimates across same-item price transitions", () => {
  const first = view("included_overage", "0.75");
  const second = structuredClone(first);
  second.record.binding.plan.version = "v2";
  second.record.binding.stripePriceId = "price_v2";
  second.subscription = { ...subscription, stripePriceId: "price_v2" };
  const result = summarizeUsageRecords([first, second], {
    period,
    complete: true,
    observedAt: 1201,
  });
  expect(result.groups).toHaveLength(2);
  for (const group of result.groups) {
    expect(group.acceptedQuantity).toBe("0.75");
    expect(group.included).toMatchObject({
      status: "unavailable",
      reason: "ambiguous_subscription_binding",
    });
    expect(group.estimate).toMatchObject({
      status: "unavailable",
      reason: "ambiguous_subscription_binding",
    });
  }
});

it("combines semantically identical snapshots regardless of property order", () => {
  const first = view("included_overage", "0.75");
  const second = structuredClone(first);
  second.subscription = {
    interval: subscription.interval,
    period: { end: period.end, start: period.start },
    stripePriceId: subscription.stripePriceId,
    subscriptionItemId: subscription.subscriptionItemId,
    subscriptionId: subscription.subscriptionId,
  };
  const result = summarizeUsageRecords([first, second], {
    period,
    complete: true,
    observedAt: 1201,
  });
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].included).toMatchObject({
    status: "available",
    value: { consumed: "1.5", overage: "0.5" },
  });
});
