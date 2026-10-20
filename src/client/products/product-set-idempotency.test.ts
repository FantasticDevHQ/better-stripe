import { componentsGeneric } from "convex/server";
import Stripe from "stripe";
import { expect, it, vi } from "vitest";

import { STRIPE_API_VERSION } from "../constants.js";
import type { Component, RunCtx } from "../helpers.js";
import { BetterStripe } from "../index.js";

function fixture() {
  const requests: { path: string; key: string | null; body: string }[] = [];
  let failure: { status: number; type: string; code?: string } | undefined;
  const sdk = new Stripe("sk_test_product_set_synthetic", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      expect(init?.method).toBe("POST");
      expect(new URL(String(url)).pathname).toBe("/v1/products/prod_original");
      requests.push({
        path: new URL(String(url)).pathname,
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: String(init?.body ?? ""),
      });
      return new Response(
        JSON.stringify(
          failure
            ? {
                error: {
                  type: failure.type,
                  code: failure.code,
                  message: "Synthetic SET failure",
                },
              }
            : { id: "prod_original", object: "product", active: false },
        ),
        {
          status: failure?.status ?? 200,
          headers: { "content-type": "application/json" },
        },
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
    { STRIPE_SECRET_KEY: "sk_test_product_set_synthetic" },
  );
  const ctx: RunCtx = { runQuery: vi.fn().mockResolvedValue(null) };
  return {
    client,
    ctx,
    requests,
    fail(status: number, type: string, code?: string) {
      failure = { status, type, code };
    },
  };
}

it("forwards the public update key as an HTTP request option without changing product parameters", async () => {
  const f = fixture();
  const opts = {
    stripeProductId: "prod_original",
    name: "Renamed",
    active: false,
    idempotencyKey: "catalog-set:original",
  } satisfies Parameters<BetterStripe["updateProduct"]>[1];
  expect(await f.client.updateProduct(f.ctx, opts)).toEqual({ success: true });
  expect(f.requests).toEqual([
    {
      path: "/v1/products/prod_original",
      key: "catalog-set:original",
      body: "name=Renamed&active=false",
    },
  ]);
});

it("forwards the public deactivate key without putting it into product metadata or parameters", async () => {
  const f = fixture();
  const opts = {
    stripeProductId: "prod_original",
    idempotencyKey: "catalog-archive:original",
  } satisfies Parameters<BetterStripe["deactivateProduct"]>[1];
  expect(await f.client.deactivateProduct(f.ctx, opts)).toEqual({
    success: true,
  });
  expect(f.requests).toEqual([
    {
      path: "/v1/products/prod_original",
      key: "catalog-archive:original",
      body: "active=false",
    },
  ]);
});

it("keeps repeated and later intentional SET keys isolated across the same client", async () => {
  const f = fixture();
  const opts = {
    stripeProductId: "prod_original",
    active: false,
    idempotencyKey: "catalog-set:original",
  };
  await f.client.updateProduct(f.ctx, opts);
  await f.client.updateProduct(f.ctx, opts);
  await f.client.deactivateProduct(f.ctx, {
    stripeProductId: "prod_original",
    idempotencyKey: "catalog-set:later",
  });
  expect(f.requests.map((r) => r.key)).toEqual([
    "catalog-set:original",
    "catalog-set:original",
    "catalog-set:later",
  ]);
  expect(f.requests.map((r) => r.body)).toEqual([
    "active=false",
    "active=false",
    "active=false",
  ]);
});

it("preserves omitted-key SET behavior and does not inherit a previous caller key", async () => {
  const f = fixture();
  await f.client.updateProduct(f.ctx, {
    stripeProductId: "prod_original",
    idempotencyKey: "catalog-set:previous",
  });
  await f.client.updateProduct(f.ctx, {
    stripeProductId: "prod_original",
    name: "Unkeyed edit",
  });
  await f.client.deactivateProduct(f.ctx, { stripeProductId: "prod_original" });
  // Stripe-node supplies fresh automatic retry keys; callers without a key must
  // retain that behavior, rather than inheriting another caller's stable key.
  expect(f.requests.slice(1).map((r) => r.key)).toEqual([
    expect.stringMatching(/^stripe-node-retry-/),
    expect.stringMatching(/^stripe-node-retry-/),
  ]);
  expect(new Set(f.requests.slice(1).map((r) => r.key)).size).toBe(2);
  expect(f.requests.slice(1).map((r) => r.body)).toEqual([
    "name=Unkeyed%20edit",
    "active=false",
  ]);
});

it.each(
  (["update", "deactivate"] as const).flatMap((method) =>
    [
      {
        status: 400,
        type: "idempotency_error",
        code: undefined,
        errorClass: Stripe.errors.StripeIdempotencyError,
      },
      {
        status: 409,
        type: "idempotency_error",
        code: "idempotency_key_in_use",
        errorClass: Stripe.errors.StripeAPIError,
      },
      {
        status: 500,
        type: "api_error",
        code: undefined,
        errorClass: Stripe.errors.StripeAPIError,
      },
    ].map((failure) => ({ method, ...failure })),
  ),
)(
  "preserves HTTP$status for $method with the original key and no extra attempt",
  async ({ method, status, type, code, errorClass }) => {
    const f = fixture();
    f.fail(status, type, code);
    const opts = {
      stripeProductId: "prod_original",
      idempotencyKey: "catalog-set:conflict",
    };
    const request =
      method === "update"
        ? f.client.updateProduct(f.ctx, opts)
        : f.client.deactivateProduct(f.ctx, opts);
    await expect(request).rejects.toBeInstanceOf(errorClass);
    await expect(request).rejects.toMatchObject({ statusCode: status, code });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.key).toBe(opts.idempotencyKey);
  },
);
