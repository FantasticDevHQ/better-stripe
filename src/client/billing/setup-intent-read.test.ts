import { componentsGeneric } from "convex/server";
import Stripe from "stripe";
import { expect, it, vi } from "vitest";

import { STRIPE_API_VERSION } from "../constants.js";
import type { Component, RunCtx } from "../helpers.js";
import { BetterStripe } from "../index.js";

function fixture() {
  const requests: { method: string; path: string }[] = [];
  const realms: (string | null)[] = [];
  const setup = {
    id: "seti_original",
    object: "setup_intent",
    customer_account: "acct_original",
    usage: "off_session",
    status: "requires_action",
    client_secret: "seti_original_secret_synthetic",
    metadata: { userId: "owner" },
  };
  let failure: Response | undefined;
  const sdk = new Stripe("sk_test_setup_read_fixture", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      realms.push(new Headers(init?.headers).get("Stripe-Account"));
      requests.push({
        method: init?.method ?? "GET",
        path: new URL(String(url)).pathname,
      });
      if (failure) return failure.clone();
      return new Response(
        JSON.stringify(
          new URL(String(url)).pathname.includes("/setup_intents/")
            ? setup
            : {
                id: "sub_original",
                object: "subscription",
                customer_account: "acct_original",
                status: "active",
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  });
  class Client extends BetterStripe {
    protected override stripe() {
      return sdk;
    }
  }
  const client = new Client(
    componentsGeneric().betterStripe as unknown as Component,
    { STRIPE_SECRET_KEY: "sk_test_setup_read_fixture" },
  );
  const runQuery = vi
    .fn()
    .mockResolvedValue({ userId: "owner", stripeAccountId: "acct_original" });
  const ctx: RunCtx = { runQuery };
  const opts = {
    userId: "owner",
    customerAccount: "acct_original",
    setupIntentId: "seti_original",
    usage: "off_session" as const,
  };
  return {
    client,
    ctx,
    requests,
    realms,
    setup,
    runQuery,
    opts,
    fail: (response: Response) => {
      failure = response;
    },
  };
}

it("retains the public exact subscription provider read as an existing positive", async () => {
  const f = fixture();
  expect(
    await f.client.getSubscriptionFromStripe(f.ctx, {
      stripeSubscriptionId: "sub_original",
    }),
  ).toMatchObject({
    id: "sub_original",
    customer_account: "acct_original",
    status: "active",
  });
  expect(f.requests).toEqual([
    { method: "GET", path: "/v1/subscriptions/sub_original" },
  ]);
});

it("provides a public qualified exact existing SetupIntent read for original-request recovery", async () => {
  const f = fixture();
  expect(await f.client.getSetupIntentFromStripe(f.ctx, f.opts)).toEqual({
    setupIntentId: "seti_original",
    customerAccount: "acct_original",
    usage: "off_session",
    status: "requires_action",
    clientSecret: "seti_original_secret_synthetic",
    observedAt: expect.any(Number),
  });
  expect(f.realms).toEqual([null]);
  expect(f.runQuery).toHaveBeenCalledWith(expect.anything(), {
    stripeAccountId: "acct_original",
    requireUnique: true,
  });
  expect(f.requests).toEqual([
    { method: "GET", path: "/v1/setup_intents/seti_original" },
  ]);
});

it.each([
  null,
  { userId: "foreign", stripeAccountId: "acct_original" },
  { userId: "owner", stripeAccountId: "acct_other" },
])(
  "rejects missing, ambiguous or foreign original account %j before provider access",
  async (account) => {
    const f = fixture();
    f.runQuery.mockResolvedValue(account);
    await expect(
      f.client.getSetupIntentFromStripe(f.ctx, f.opts),
    ).rejects.toThrow(/account/);
    expect(f.requests).toEqual([]);
  },
);

it.each([
  { id: "seti_other" },
  { customer_account: "acct_other" },
  { metadata: { userId: "foreign" } },
  { usage: "on_session" },
  { status: "invented" },
  { metadata: {} },
])("rejects contradictory existing setup response %j", async (override) => {
  const f = fixture();
  Object.assign(f.setup, override);
  await expect(
    f.client.getSetupIntentFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/original request/);
  expect(f.requests).toHaveLength(1);
});

it.each(["succeeded", "canceled", "processing"])(
  "omits the secret for %s observations",
  async (status) => {
    const f = fixture();
    f.setup.status = status;
    const result = await f.client.getSetupIntentFromStripe(f.ctx, f.opts);
    expect(result.status).toBe(status);
    expect(result).not.toHaveProperty("clientSecret");
    expect(result).not.toHaveProperty("metadata");
    expect(result).not.toHaveProperty("payment_method");
  },
);

it.each([
  "requires_action",
  "requires_confirmation",
  "requires_payment_method",
])("requires an available transient secret for %s", async (status) => {
  const f = fixture();
  f.setup.status = status;
  f.setup.client_secret = "";
  await expect(
    f.client.getSetupIntentFromStripe(f.ctx, f.opts),
  ).rejects.toThrow(/secret/);
});

it("freezes every original primitive selector before the first await without freezing the caller", async () => {
  const f = fixture();
  f.runQuery.mockImplementation(async () => {
    Object.assign(f.opts, {
      userId: "foreign",
      customerAccount: "acct_other",
      setupIntentId: "seti_other",
      usage: "on_session",
    });
    return { userId: "owner", stripeAccountId: "acct_original" };
  });
  expect(await f.client.getSetupIntentFromStripe(f.ctx, f.opts)).toMatchObject({
    setupIntentId: "seti_original",
    customerAccount: "acct_original",
    usage: "off_session",
  });
  expect(f.opts.setupIntentId).toBe("seti_other");
  expect(Object.isFrozen(f.opts)).toBe(false);
  expect(f.requests).toEqual([
    { method: "GET", path: "/v1/setup_intents/seti_original" },
  ]);
});

it("preserves provider failure without searching or creating a setup", async () => {
  const f = fixture();
  f.fail(
    new Response(
      JSON.stringify({
        error: {
          message: "synthetic missing setup",
          type: "invalid_request_error",
          code: "resource_missing",
        },
      }),
      { status: 404 },
    ),
  );
  await expect(
    f.client.getSetupIntentFromStripe(f.ctx, f.opts),
  ).rejects.toMatchObject({ code: "resource_missing" });
  expect(f.requests).toEqual([
    { method: "GET", path: "/v1/setup_intents/seti_original" },
  ]);
});

it.each([
  { userId: " owner" },
  { customerAccount: "acct_bad/realm" },
  { setupIntentId: "seti_bad?query" },
  { usage: "unsupported" },
])(
  "rejects invalid original selectors %j before any read",
  async (override) => {
    const f = fixture();
    Object.assign(f.opts, override);
    await expect(
      f.client.getSetupIntentFromStripe(f.ctx, f.opts),
    ).rejects.toThrow(/selectors/);
    expect(f.runQuery).not.toHaveBeenCalled();
    expect(f.requests).toEqual([]);
  },
);

it.each([undefined, "payment_intent"])(
  "rejects a wrong or missing SetupIntent object discriminator %s",
  async (object) => {
    const f = fixture();
    Object.assign(f.setup, { object });
    await expect(
      f.client.getSetupIntentFromStripe(f.ctx, f.opts),
    ).rejects.toThrow(/original request/);
  },
);
