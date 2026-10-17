import Stripe from "stripe";
import { expect, it } from "vitest";

import { STRIPE_API_VERSION } from "../constants.js";
import type { RunCtx } from "../helpers.js";
import { BetterStripe } from "../index.js";
import { components } from "../setup.test.js";

function fixture() {
  const requests: {
    path: string;
    method: string;
    body: string;
    realm: string | null;
    key: string | null;
  }[] = [];
  const original = {
    id: "sub_original",
    object: "subscription",
    customer_account: "acct_original",
    managed_payments: null,
    default_payment_method: "pm_old",
    status: "active",
  };
  const other = {
    ...original,
    id: "sub_other",
    default_payment_method: "pm_other",
  };
  const card = {
    id: "pm_original",
    object: "payment_method",
    type: "card",
    customer_account: "acct_original",
  };
  const responses = new Map<string, Response>();
  const counts = new Map<string, number>();
  const sdk = new Stripe("sk_test_subscription_card_fixture", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      const path = new URL(String(url)).pathname;
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      const body = String(init?.body ?? "");
      requests.push({
        path,
        method,
        body,
        realm: headers.get("Stripe-Account"),
        key: headers.get("Idempotency-Key"),
      });
      const requestKey = `${method} ${path}`;
      const ordinal = (counts.get(requestKey) ?? 0) + 1;
      counts.set(requestKey, ordinal);
      const override = responses.get(`${requestKey} ${ordinal}`);
      if (override) return override.clone();
      if (method === "POST" && path === "/v1/subscriptions/sub_original") {
        original.default_payment_method =
          new URLSearchParams(body).get("default_payment_method") ??
          original.default_payment_method;
      }
      const data = path.includes("/payment_methods/")
        ? card
        : path.endsWith("sub_other")
          ? other
          : original;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  });
  class Client extends BetterStripe {
    protected override stripe() {
      return sdk;
    }
  }
  const client = new Client(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_subscription_card_fixture",
  });
  const ctx: RunCtx = {
    runQuery: async () => {
      throw new Error("Unexpected component read");
    },
  };
  const opts = {
    stripeSubscriptionId: original.id,
    customerAccount: original.customer_account,
    paymentMethodId: card.id,
    idempotencyKey: "subscription-card-original-command",
  };
  return { client, ctx, opts, original, other, card, requests, responses };
}

it("retains the actual public subscription provider read as a V2 payer positive control", async () => {
  const f = fixture();
  const result = await f.client.getSubscriptionFromStripe(f.ctx, {
    stripeSubscriptionId: f.original.id,
  });
  expect(result).toMatchObject({
    id: f.original.id,
    customer_account: f.opts.customerAccount,
    managed_payments: null,
  });
  expect(f.requests).toMatchObject([
    { method: "GET", path: "/v1/subscriptions/sub_original" },
  ]);
});

it("changes only the explicit existing subscription card and confirms through a fresh read", async () => {
  const f = fixture();
  const otherBefore = structuredClone(f.other);
  expect(f.client).toHaveProperty(
    "updateSubscriptionDefaultPaymentMethod",
    expect.any(Function),
  );
  const result = await f.client.updateSubscriptionDefaultPaymentMethod(
    f.ctx,
    f.opts,
  );
  expect(result).toMatchObject({
    status: "updated",
    stripeSubscriptionId: f.opts.stripeSubscriptionId,
    customerAccount: f.opts.customerAccount,
    paymentMethodId: f.opts.paymentMethodId,
  });
  expect(f.other).toEqual(otherBefore);
  expect(f.requests.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: "GET", path: "/v1/subscriptions/sub_original" },
    { method: "GET", path: "/v1/payment_methods/pm_original" },
    { method: "POST", path: "/v1/subscriptions/sub_original" },
    { method: "GET", path: "/v1/subscriptions/sub_original" },
  ]);
  expect(f.requests[2]).toMatchObject({
    body: "default_payment_method=pm_original",
    key: f.opts.idempotencyKey,
  });
});

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

it.each([
  ["subscription", "unavailable", "subscription_mismatch"],
  ["payer", "unavailable", "payer_mismatch"],
  ["legacy", "unsupported", "non_v2_payer"],
  ["method", "unavailable", "method_mismatch"],
  ["owner", "unavailable", "method_owner_mismatch"],
  ["type", "unsupported", "non_card_method"],
] as const)(
  "rejects original %s conflicts before POST",
  async (variant, status, reason) => {
    const f = fixture();
    if (variant === "subscription") f.original.id = "sub_foreign";
    if (variant === "payer") f.original.customer_account = "acct_foreign";
    if (variant === "legacy")
      Object.assign(f.original, {
        customer_account: null,
        customer: "cus_legacy",
      });
    if (variant === "method") f.card.id = "pm_other";
    if (variant === "owner") f.card.customer_account = "acct_foreign";
    if (variant === "type") f.card.type = "sepa_debit";
    expect(
      await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
    ).toEqual({ status, reason });
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
  },
);

it.each(["enabled", "missing", "malformed"] as const)(
  "does not guess ordinary Managed Payments state from %s",
  async (variant) => {
    const f = fixture();
    if (variant === "missing")
      Reflect.deleteProperty(f.original, "managed_payments");
    else
      Object.assign(f.original, {
        managed_payments: { enabled: variant === "enabled" ? true : "false" },
      });
    expect(
      await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
    ).toEqual({
      status: "unsupported",
      reason:
        variant === "enabled" ? "managed_payments" : "unknown_managed_payments",
    });
    expect(f.requests).toHaveLength(1);
  },
);

it("supports explicitly disabled Managed Payments and scopes every request to the same realm", async () => {
  const f = fixture();
  Object.assign(f.original, { managed_payments: { enabled: false } });
  expect(
    await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, {
      ...f.opts,
      connectedAccountId: "acct_merchant",
    }),
  ).toMatchObject({ status: "updated" });
  expect(f.requests).toHaveLength(4);
  expect(f.requests.every((r) => r.realm === "acct_merchant")).toBe(true);
  expect(f.requests[2]?.key).toBe(f.opts.idempotencyKey);
});

it.each(["pre-read", "post", "fresh-read"] as const)(
  "keeps %s provider failure distinct from confirmation",
  async (phase) => {
    const f = fixture();
    const request =
      phase === "pre-read"
        ? "GET /v1/subscriptions/sub_original 1"
        : phase === "post"
          ? "POST /v1/subscriptions/sub_original 1"
          : "GET /v1/subscriptions/sub_original 2";
    f.responses.set(
      request,
      jsonResponse(
        { error: { type: "api_error", message: "Synthetic unavailable" } },
        503,
      ),
    );
    expect(
      await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
    ).toEqual(
      phase === "pre-read"
        ? { status: "unavailable", reason: "provider_read_unavailable" }
        : { status: "unknown", reason: "provider_write_unconfirmed" },
    );
  },
);

it("does not confirm an old idempotent POST reply after a later card selection", async () => {
  const f = fixture();
  f.responses.set(
    "POST /v1/subscriptions/sub_original 1",
    jsonResponse({
      ...f.original,
      default_payment_method: f.opts.paymentMethodId,
    }),
  );
  f.responses.set(
    "GET /v1/subscriptions/sub_original 2",
    jsonResponse({
      ...f.original,
      default_payment_method: "pm_later_selection",
    }),
  );
  expect(
    await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
  ).toEqual({ status: "unknown", reason: "response_mismatch" });
  expect(f.requests[f.requests.length - 1]?.method).toBe("GET");
});

it("accepts expanded card proof only when the original payer still agrees", async () => {
  const f = fixture();
  f.responses.set(
    "POST /v1/subscriptions/sub_original 1",
    jsonResponse({ ...f.original, default_payment_method: f.card }),
  );
  f.responses.set(
    "GET /v1/subscriptions/sub_original 2",
    jsonResponse({ ...f.original, default_payment_method: f.card }),
  );
  expect(
    await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
  ).toMatchObject({ status: "updated" });
});

it("does not confirm a response with a contradictory expanded card owner", async () => {
  const f = fixture();
  f.responses.set(
    "POST /v1/subscriptions/sub_original 1",
    jsonResponse({
      ...f.original,
      default_payment_method: { ...f.card, customer_account: "acct_foreign" },
    }),
  );
  expect(
    await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
  ).toEqual({ status: "unknown", reason: "response_mismatch" });
});

it("forwards the unchanged original idempotency key and never touches the other subscription", async () => {
  const f = fixture();
  const other = structuredClone(f.other);
  for (let i = 0; i < 2; i++)
    expect(
      await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, f.opts),
    ).toMatchObject({ status: "updated" });
  expect(
    f.requests
      .filter((r) => r.method === "POST")
      .map((r) => ({ body: r.body, key: r.key })),
  ).toEqual([
    { body: "default_payment_method=pm_original", key: f.opts.idempotencyKey },
    { body: "default_payment_method=pm_original", key: f.opts.idempotencyKey },
  ]);
  expect(f.other).toEqual(other);
});

it.each([
  "paymentMethodId",
  "stripeSubscriptionId",
  "customerAccount",
  "idempotencyKey",
] as const)(
  "rejects a malformed %s without provider traffic",
  async (field) => {
    const f = fixture();
    expect(
      await f.client.updateSubscriptionDefaultPaymentMethod(f.ctx, {
        ...f.opts,
        [field]: " bad selector ",
      }),
    ).toEqual({ status: "unavailable", reason: "invalid_selector" });
    expect(f.requests).toHaveLength(0);
  },
);
