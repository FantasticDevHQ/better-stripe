import Stripe from "stripe";
import { expect, it, vi } from "vitest";
import { componentsGeneric } from "convex/server";
import type { Component, RunCtx } from "../helpers.js";
import { STRIPE_API_VERSION } from "../constants.js";
import { prepareUsageRecord } from "./records.js";
import { deliverUsageProvider } from "./deliveryProvider.js";
const scope = {
  stripeAccountId: "acct_platform",
  customerAccount: "acct_buyer",
  meterId: "mtr_calls",
  livemode: false,
};
function setup(
  status = 200,
  errorCode = "parameter_invalid_integer",
  nativeOverrides: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
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
        unit: { name: "call", precision: 2 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      },
    },
    sourceEventId: "one",
    quantity: "1.2",
    occurredAt: now,
  });
  const saved = {
    billingCutoff: null as number | null,
    managedCollection: null as {
      method: "send_invoice" | "charge_automatically";
      daysUntilDue: number | null;
      defaultPaymentMethod: string | null;
    } | null,
    event: {
      recordJson: JSON.stringify(record),
      subscriptionJson: JSON.stringify({
        subscriptionId: "sub_calls",
        subscriptionItemId: "si_calls",
        stripePriceId: "price_calls",
        period: { start: now - 1, end: now + 86400 },
        interval: "month",
      }),
    },
    outbox: {
      state: "sending",
      attempts: 1,
      definitionVersion: 1,
      providerIdentifier: "bs_usage_event",
      firstSendAt: now,
      leaseUntil: now + 900,
    },
  };
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(saved),
  } as unknown as RunCtx;
  const requests: Array<{
    path: string;
    headers: Headers;
    body: URLSearchParams;
  }> = [];
  const httpClient = Stripe.createFetchHttpClient(async (input, init) => {
    const path = new URL(String(input)).pathname,
      body = new URLSearchParams(String(init?.body ?? ""));
    requests.push({ path, body, headers: new Headers(init?.headers) });
    const value =
      path === "/v1/account"
        ? { id: "acct_platform" }
        : path === "/v1/balance"
          ? { livemode: false }
          : path === "/v1/billing/meters/mtr_calls"
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
            : path === "/v1/subscriptions/sub_calls"
              ? {
                  id: "sub_calls",
                  livemode: false,
                  customer: "cus_buyer",
                  customer_account: "acct_buyer",
                  ...nativeOverrides,
                }
              : status === 200
                ? {
                    object: "billing.meter_event",
                    identifier: body.get("identifier"),
                    event_name: "calls",
                    livemode: false,
                    timestamp: now,
                    created: now,
                    payload: { stripe_customer_id: "cus_buyer", value: "120" },
                  }
                : {
                    error: {
                      type: status === 429 ? "rate_limit_error" : "api_error",
                      message: "private provider detail",
                      code: errorCode,
                    },
                  };
    if (path === "/v1/billing/meter_events" && status === 0)
      throw new Error("Lost accepted response");
    return new Response(JSON.stringify(value), {
      status: path === "/v1/billing/meter_events" ? status : 200,
      headers: { "content-type": "application/json" },
    });
  });
  const request = {
    scope,
    eventId: "event",
    attempt: 1,
    definitionVersion: 1 as const,
    apiVersion: STRIPE_API_VERSION,
    identifier: "bs_usage_event",
  };
  return { ctx, request, requests, httpClient, saved };
}
it("sends scaled native values with stable identifiers and no SDK retries", async () => {
  const f = setup();
  const result = await deliverUsageProvider(
    componentsGeneric().betterStripe as unknown as Component,
    f.ctx,
    f.request,
    { stripeSecretKey: "sk_test_usage", httpClient: f.httpClient },
  );
  expect(result).toMatchObject({
    ...f.request,
    outcome: { status: "accepted" },
  });
  const posts = f.requests.filter((r) => r.path === "/v1/billing/meter_events");
  expect(posts).toHaveLength(1);
  expect(posts[0].body.get("payload[value]")).toBe("120");
  expect(posts[0].headers.get("idempotency-key")).toBe("bs_usage_event");
  expect(posts[0].headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
});
it.each([
  [429, "rate_limited"],
  [500, "unknown"],
  [401, "unavailable"],
  [400, "rejected"],
])(
  "classifies HTTP %i without leaking raw errors",
  async (status, expected) => {
    const f = setup(status);
    const result = await deliverUsageProvider(
      componentsGeneric().betterStripe as unknown as Component,
      f.ctx,
      f.request,
      { stripeSecretKey: "sk_test_usage", httpClient: f.httpClient },
    );
    expect(result).toMatchObject({ outcome: { status: expected } });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
    expect(
      f.requests.filter((r) => r.path === "/v1/billing/meter_events"),
    ).toHaveLength(1);
  },
);
it("does not send after the deduplication window or with unavailable credentials", async () => {
  const f = setup();
  f.saved.outbox.firstSendAt -= 24 * 3600;
  expect(
    await deliverUsageProvider(
      componentsGeneric().betterStripe as unknown as Component,
      f.ctx,
      f.request,
      { stripeSecretKey: "sk_test_usage", httpClient: f.httpClient },
    ),
  ).toMatchObject({ outcome: { status: "unknown" } });
  expect(f.requests).toHaveLength(0);
  const other = setup();
  expect(
    await deliverUsageProvider(
      componentsGeneric().betterStripe as unknown as Component,
      other.ctx,
      other.request,
      {},
    ),
  ).toMatchObject({ outcome: { status: "unavailable" } });
  expect(other.requests).toHaveLength(0);
});

it("holds duplicate/uncertain errors and a lost response instead of retrying transport", async () => {
  for (const [status, code] of [
    [400, "duplicate_meter_event"],
    [0, "lost"],
  ] as const) {
    const f = setup(status, code);
    const result = await deliverUsageProvider(
      componentsGeneric().betterStripe as unknown as Component,
      f.ctx,
      f.request,
      { stripeSecretKey: "sk_test_usage", httpClient: f.httpClient },
    );
    expect(result).toMatchObject({ outcome: { status: "unknown" } });
    expect(
      f.requests.filter((r) => r.path === "/v1/billing/meter_events"),
    ).toHaveLength(1);
  }
});

it("withholds a managed send that reaches its billing cutoff during preflight", async () => {
  const f = setup();
  const now = Math.floor(Date.now() / 1000);
  f.saved.billingCutoff = now + 100;
  let reads = 0;
  vi.mocked(f.ctx.runQuery).mockImplementation(async () => {
    reads++;
    return { ...f.saved, billingCutoff: reads === 1 ? now + 100 : now + 10 };
  });
  const result = await deliverUsageProvider(
    componentsGeneric().betterStripe as unknown as Component,
    f.ctx,
    f.request,
    { stripeSecretKey: "sk_test_usage", httpClient: f.httpClient },
  );
  expect(result.outcome.status).toBe("unknown");
  expect(f.requests.some((r) => r.path === "/v1/billing/meter_events")).toBe(
    false,
  );
});

it("withholds a managed send when native manual invoicing drifts to automatic charging", async () => {
  const now = Math.floor(Date.now() / 1000);
  const f = setup(200, "parameter_invalid_integer", {
    status: "active",
    collection_method: "charge_automatically",
    days_until_due: null,
    default_payment_method: "pm_owned",
    items: {
      has_more: false,
      data: [
        {
          id: "si_calls",
          price: { id: "price_calls" },
          current_period_start: now - 1,
          current_period_end: now + 86400,
        },
      ],
    },
  });
  f.saved.billingCutoff = now + 86400 - 60;
  f.saved.managedCollection = {
    method: "send_invoice",
    daysUntilDue: 30,
    defaultPaymentMethod: null,
  };
  const result = await deliverUsageProvider(
    componentsGeneric().betterStripe as unknown as Component,
    f.ctx,
    f.request,
    { stripeSecretKey: "sk_test_usage", httpClient: f.httpClient },
  );
  expect(result.outcome.status).toBe("unavailable");
  expect(f.requests.some((r) => r.path === "/v1/billing/meter_events")).toBe(
    false,
  );
});
