import { expect, it } from "vitest";
import { compareUsageObservations } from "./reconciliation.js";
import { summarizeUsageRecords } from "./summary.js";
import { prepareUsageRecord } from "./records.js";
const period = { start: 600, end: 1200 },
  scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  };
const record = prepareUsageRecord({
  scope,
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "pay_as_you_go",
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
    },
  },
  sourceEventId: "one",
  quantity: "2",
  occurredAt: 700,
});
const subscription = {
  subscriptionId: "sub_calls",
  subscriptionItemId: "si_calls",
  stripePriceId: "price_calls",
  period,
  interval: "month" as const,
};
const local = summarizeUsageRecords(
  [
    {
      record,
      subscription,
      delivery: "provider_accepted",
      hasValidationError: false,
    },
  ],
  { period, complete: true, observedAt: 1201 },
);
const aggregate = {
  status: "available" as const,
  observedAt: 1201,
  value: {
    period,
    quantity: "2",
    scaledQuantity: "2",
    complete: true,
    nextCursor: null,
    aggregationLagPossible: true as const,
    stale: false,
    entries: [{ id: "mtrusg_one", start: 600, end: 1200, scaledQuantity: "2" }],
  },
};
it("separates observed matches from mismatches without changing usage", () => {
  expect(
    compareUsageObservations(local, aggregate, record.binding),
  ).toMatchObject({
    status: "observed_match",
    localAcceptedQuantity: "2",
    providerAcceptedQuantity: "2",
    providerAggregateQuantity: "2",
  });
  expect(
    compareUsageObservations(
      local,
      {
        ...aggregate,
        value: { ...aggregate.value, quantity: "0", scaledQuantity: "0" },
      },
      record.binding,
    ),
  ).toMatchObject({
    status: "mismatch",
    reason: "aggregation_lag_or_external_usage",
  });
  expect(record.quantity).toBe("2");
});
it("cannot compare stale, incomplete, absent or differently routed observations", () => {
  expect(
    compareUsageObservations(
      local,
      { ...aggregate, value: { ...aggregate.value, stale: true } },
      record.binding,
    ),
  ).toMatchObject({ status: "unavailable", reason: "aggregate_stale" });
  expect(
    compareUsageObservations(
      { ...local, complete: false },
      aggregate,
      record.binding,
    ),
  ).toMatchObject({
    status: "unavailable",
    reason: "local_history_incomplete",
  });
  expect(
    compareUsageObservations(
      local,
      { status: "unavailable", reason: "aggregation_pending", retryable: true },
      record.binding,
    ),
  ).toMatchObject({ status: "unavailable", providerAggregateQuantity: null });
  expect(
    compareUsageObservations(local, aggregate, {
      ...record.binding,
      stripePriceId: "price_changed",
    }),
  ).toMatchObject({ status: "unavailable", reason: "ambiguous_local_terms" });
});
