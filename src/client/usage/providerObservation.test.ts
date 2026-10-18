import { componentsGeneric, type FunctionReference } from "convex/server";
import { BetterStripe } from "../index.js";
import { initConvexTest } from "../setup.test.js";
import { schema, modules } from "../../test.js";
import type { Component, RunCtx } from "../helpers.js";
import Stripe from "stripe";
import { expect, it, vi } from "vitest";
import { STRIPE_API_VERSION } from "../constants.js";
import { prepareUsageRecord } from "./records.js";
import { observeProviderUsage } from "./providerObservation.js";
const scope = {
  stripeAccountId: "acct_platform",
  customerAccount: "acct_buyer",
  meterId: "mtr_calls",
  livemode: false,
};
const period = { start: 600, end: 1200 };
const binding = prepareUsageRecord({
  scope,
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
  sourceEventId: "validation",
  quantity: "0",
  occurredAt: 600,
}).binding;
const options = {
  scope,
  binding,
  subscription: {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period,
    interval: "month" as const,
  },
  period,
  limit: 100,
  cursor: null,
};
function setup(value = 125, hasMore = false, empty = false) {
  const requests: Array<URL> = [];
  const httpClient = Stripe.createFetchHttpClient(async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const result =
      url.pathname === "/v1/account"
        ? { id: "acct_platform" }
        : url.pathname === "/v1/balance"
          ? { livemode: false }
          : url.pathname === "/v1/billing/meters/mtr_calls"
            ? {
                id: "mtr_calls",
                livemode: false,
                status: "active",
                event_name: "calls",
                default_aggregation: { formula: "sum" },
                customer_mapping: {
                  type: "by_id",
                  event_payload_key: "stripe_customer_id",
                },
                value_settings: { event_payload_key: "value" },
                event_time_window: null,
              }
            : url.pathname === "/v1/subscriptions/sub_calls"
              ? {
                  id: "sub_calls",
                  livemode: false,
                  customer: "cus_buyer",
                  customer_account: "acct_buyer",
                }
              : {
                  object: "list",
                  data: empty
                    ? []
                    : [
                        {
                          id: "mtrusg_one",
                          object: "billing.meter_event_summary",
                          meter: "mtr_calls",
                          livemode: false,
                          start_time: 600,
                          end_time: 1200,
                          aggregated_value: value,
                        },
                      ],
                  has_more: hasMore,
                };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const stripe = new Stripe("sk_test_observe", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient,
  });
  return { stripe, requests, httpClient };
}
it("reads exact native quantities and preserves the original customer/period", async () => {
  const f = setup();
  expect(await observeProviderUsage(f.stripe, options)).toMatchObject({
    status: "available",
    value: {
      quantity: "1.25",
      scaledQuantity: "125",
      complete: true,
      aggregationLagPossible: true,
      period,
    },
  });
  const request = f.requests.find((r) =>
    r.pathname.endsWith("event_summaries"),
  )!;
  expect(request.searchParams.get("customer")).toBe("cus_buyer");
  expect(request.searchParams.get("start_time")).toBe("600");
  expect(request.searchParams.get("end_time")).toBe("1200");
});
it("reports absent aggregation instead of zero and preserves incomplete pagination", async () => {
  expect(
    await observeProviderUsage(setup(0, false, true).stripe, options),
  ).toMatchObject({ status: "unavailable", reason: "aggregation_pending" });
  expect(
    await observeProviderUsage(setup(0, true).stripe, options),
  ).toMatchObject({
    status: "available",
    value: { quantity: "0", complete: false, nextCursor: "mtrusg_one" },
  });
});
it("rejects unaligned windows and unsafe provider numbers without rounding", async () => {
  const f = setup();
  expect(
    await observeProviderUsage(f.stripe, {
      ...options,
      period: { start: 601, end: 1200 },
    }),
  ).toMatchObject({
    status: "unsupported",
    reason: "minute_alignment_required",
  });
  expect(f.requests).toHaveLength(0);
  expect(
    await observeProviderUsage(
      setup(Number.MAX_SAFE_INTEGER + 1).stripe,
      options,
    ),
  ).toMatchObject({
    status: "unavailable",
    reason: "provider_precision_unsupported",
  });
});

it("caches through the public facade without resending usage and exposes stale data", async () => {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const client = new BetterStripe(
    componentsGeneric().betterStripe as unknown as Component,
  );
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => t.mutation(ref, args),
  } as RunCtx;
  const f = setup();
  expect(await client.usage.getProviderUsage(ctx, options)).toMatchObject({
    status: "unavailable",
    reason: "provider_not_observed",
  });
  const result = await client.usage.reconcile(ctx, options, {
    stripeSecretKey: "sk_test_observe",
    httpClient: f.httpClient,
  });
  expect(result).toMatchObject({
    local: { complete: true, eventCount: 0 },
    aggregate: { status: "available", value: { quantity: "1.25" } },
    comparison: { status: "mismatch" },
    invoice: { status: "unavailable" },
  });
  expect(
    f.requests.every((url) => !url.pathname.endsWith("meter_events")),
  ).toBe(true);
  const now = Date.now(),
    clock = vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  try {
    expect(await client.usage.getReconciliation(ctx, options)).toMatchObject({
      aggregate: { status: "available", value: { stale: true } },
      comparison: { status: "unavailable", reason: "aggregate_stale" },
    });
  } finally {
    clock.mockRestore();
  }
});
