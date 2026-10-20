import { componentsGeneric } from "convex/server";
import Stripe from "stripe";
import { expect, it, vi } from "vitest";

import { STRIPE_API_VERSION } from "../constants.js";
import type { Component, RunCtx } from "../helpers.js";
import { BetterStripe } from "../index.js";

function fixture(store?: string) {
  const requests: {
    path: string;
    key: string | null;
    form: URLSearchParams;
  }[] = [];
  let failure: { status: number; type: string; code?: string } | undefined;
  const sdk = new Stripe("sk_test_product_descriptor_synthetic", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      expect(init?.method).toBe("POST");
      requests.push({
        path: new URL(String(url)).pathname,
        key: new Headers(init?.headers).get("Idempotency-Key"),
        form: new URLSearchParams(String(init?.body ?? "")),
      });
      return new Response(
        JSON.stringify(
          failure
            ? { error: { ...failure, message: "Synthetic descriptor failure" } }
            : {
                id: "prod_original",
                object: "product",
                name: "Original",
                active: true,
                metadata: {},
              },
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
    {
      STRIPE_SECRET_KEY: "sk_test_product_descriptor_synthetic",
      statementDescriptorSuffix: "PLATFORM",
    },
  );
  const ctx: RunCtx = {
    runQuery: vi.fn().mockImplementation(async (_ref, args) =>
      args.stripeAccountId
        ? { statementDescriptor: store }
        : {
            _id: "component_original",
            accountId: store === undefined ? undefined : "acct_store",
          },
    ),
    runMutation: vi.fn().mockResolvedValue(null),
  };
  return {
    client,
    ctx,
    requests,
    fail(status: number, type: string, code?: string) {
      failure = { status, type, code };
    },
  };
}

it.each(["create", "update"] as const)(
  "%s sends an explicit descriptor for a platform product",
  async (method) => {
    const f = fixture();
    if (method === "create")
      await f.client.createProduct(f.ctx, {
        name: "Original",
        statementDescriptor: "  COMMUNITY ONE  ",
        metadata: { communityId: "one" },
        idempotencyKey: "descriptor:original",
      } satisfies Parameters<BetterStripe["createProduct"]>[1]);
    else
      await f.client.updateProduct(f.ctx, {
        stripeProductId: "prod_original",
        statementDescriptor: "  COMMUNITY ONE  ",
        metadata: { communityId: "one" },
        idempotencyKey: "descriptor:original",
      } satisfies Parameters<BetterStripe["updateProduct"]>[1]);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.form.get("statement_descriptor")).toBe(
      "COMMUNITY ONE",
    );
    expect(f.requests[0]?.form.get("metadata[communityId]")).toBe("one");
    expect(f.requests[0]?.form.has("accountId")).toBe(false);
    expect(f.requests[0]?.key).toBe("descriptor:original");
    expect(f.requests[0]?.path).toBe(
      method === "create" ? "/v1/products" : "/v1/products/prod_original",
    );
  },
);

it("an explicit string overrides a store descriptor without changing the account", async () => {
  const f = fixture("OLD STORE");
  await f.client.createProduct(f.ctx, {
    name: "Original",
    accountId: "acct_store",
    statementDescriptor: "COMMUNITY TWO",
  });
  await f.client.updateProduct(f.ctx, {
    stripeProductId: "prod_original",
    statementDescriptor: "COMMUNITY TWO",
  });
  expect(f.requests.map((r) => r.form.get("statement_descriptor"))).toEqual([
    "COMMUNITY TWO",
    "COMMUNITY TWO",
  ]);
  expect(f.ctx.runMutation).toHaveBeenCalledTimes(1);
});

it("update null clears exactly the selected product without restoring a store/default", async () => {
  const f = fixture("OLD STORE");
  await f.client.updateProduct(f.ctx, {
    stripeProductId: "prod_original",
    statementDescriptor: null,
    idempotencyKey: "descriptor:clear",
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.path).toBe("/v1/products/prod_original");
  expect(f.requests[0]?.form.has("statement_descriptor")).toBe(true);
  expect(f.requests[0]?.form.get("statement_descriptor")).toBe("");
  expect(f.requests[0]?.key).toBe("descriptor:clear");
});

it("create null suppresses inherited descriptors without sending an empty provider field", async () => {
  const f = fixture("OLD STORE");
  await f.client.createProduct(f.ctx, {
    name: "Original",
    accountId: "acct_store",
    statementDescriptor: null,
  });
  expect(f.requests[0]?.form.has("statement_descriptor")).toBe(false);
});

it("omission retains store/default resolution and leaves platform products unchanged", async () => {
  const store = fixture("OLD STORE");
  await store.client.createProduct(store.ctx, {
    name: "Original",
    accountId: "acct_store",
  });
  await store.client.updateProduct(store.ctx, {
    stripeProductId: "prod_original",
  });
  expect(store.requests.map((r) => r.form.get("statement_descriptor"))).toEqual(
    ["OLD STORE", "OLD STORE"],
  );
  const platform = fixture();
  await platform.client.createProduct(platform.ctx, { name: "Original" });
  await platform.client.updateProduct(platform.ctx, {
    stripeProductId: "prod_original",
  });
  expect(
    platform.requests.every((r) => !r.form.has("statement_descriptor")),
  ).toBe(true);
});

it.each([
  "",
  "   ",
  "BAD*NAME",
  "NO<NAME",
  "1234",
  "NONLATINé",
  "THIS DESCRIPTOR IS FAR TOO LONG",
])(
  "rejects explicit invalid %j before provider HTTP",
  async (statementDescriptor) => {
    const f = fixture();
    await expect(
      f.client.createProduct(f.ctx, { name: "Original", statementDescriptor }),
    ).rejects.toThrow(/statement descriptor/i);
    await expect(
      f.client.updateProduct(f.ctx, {
        stripeProductId: "prod_original",
        statementDescriptor,
      }),
    ).rejects.toThrow(/statement descriptor/i);
    expect(f.requests).toHaveLength(0);
    expect(f.ctx.runMutation).not.toHaveBeenCalled();
  },
);

it("does not inherit another explicit community descriptor or stable key", async () => {
  const f = fixture();
  for (const [stripeProductId, statementDescriptor, idempotencyKey] of [
    ["prod_original", "COMMUNITY ONE", "descriptor:one"],
    ["prod_other", "COMMUNITY TWO", "descriptor:two"],
    ["prod_original", "COMMUNITY ONE", "descriptor:one"],
  ])
    await f.client.updateProduct(f.ctx, {
      stripeProductId,
      statementDescriptor,
      idempotencyKey,
    });
  expect(
    f.requests.map((r) => [r.path, r.key, r.form.get("statement_descriptor")]),
  ).toEqual([
    ["/v1/products/prod_original", "descriptor:one", "COMMUNITY ONE"],
    ["/v1/products/prod_other", "descriptor:two", "COMMUNITY TWO"],
    ["/v1/products/prod_original", "descriptor:one", "COMMUNITY ONE"],
  ]);
});

it.each(
  (["create", "update"] as const).flatMap((method) =>
    [400, 409, 500].map((status) => ({ method, status })),
  ),
)(
  "preserves $method HTTP$status and original descriptor/key without another attempt",
  async ({ method, status }) => {
    const f = fixture();
    f.fail(
      status,
      status === 500 ? "api_error" : "idempotency_error",
      status === 409 ? "idempotency_key_in_use" : undefined,
    );
    const request =
      method === "create"
        ? f.client.createProduct(f.ctx, {
            name: "Original",
            statementDescriptor: "COMMUNITY ONE",
            idempotencyKey: "descriptor:failure",
          })
        : f.client.updateProduct(f.ctx, {
            stripeProductId: "prod_original",
            statementDescriptor: "COMMUNITY ONE",
            idempotencyKey: "descriptor:failure",
          });
    await expect(request).rejects.toBeInstanceOf(
      status === 400
        ? Stripe.errors.StripeIdempotencyError
        : Stripe.errors.StripeAPIError,
    );
    await expect(request).rejects.toMatchObject({
      statusCode: status,
      code: status === 409 ? "idempotency_key_in_use" : undefined,
    });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.key).toBe("descriptor:failure");
    expect(f.requests[0]?.form.get("statement_descriptor")).toBe(
      "COMMUNITY ONE",
    );
  },
);
