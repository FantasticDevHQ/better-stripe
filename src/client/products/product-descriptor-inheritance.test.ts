import { componentsGeneric } from "convex/server";
import Stripe from "stripe";
import { expect, expectTypeOf, it, vi } from "vitest";

import { STRIPE_API_VERSION } from "../constants.js";
import type { Component, RunCtx } from "../helpers.js";
import { BetterStripe } from "../index.js";

function fixture(storeDescriptor: string | undefined = "ORIGINAL STORE") {
  const requests: { path: string; key: string | null; form: string }[] = [];
  const state: {
    accountId: string;
    storeDescriptor: string | undefined;
    hasLostReply: boolean;
    failure?: { status: number; type: string; code?: string };
  } = { accountId: "acct_original", storeDescriptor, hasLostReply: false };
  const provider = new Stripe("sk_test_descriptor_inheritance_synthetic", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      expect(init?.method).toBe("POST");
      expect(new URL(String(url)).origin).toBe("https://api.stripe.com");
      requests.push({
        path: new URL(String(url)).pathname,
        key: new Headers(init?.headers).get("Idempotency-Key"),
        form: String(init?.body ?? ""),
      });
      if (state.hasLostReply) throw new Error("Synthetic lost SET reply");
      return new Response(
        JSON.stringify(
          state.failure
            ? { error: { ...state.failure, message: "Synthetic SET failure" } }
            : { id: "prod_original", object: "product", active: true },
        ),
        {
          status: state.failure?.status ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    }),
  });
  class Client extends BetterStripe {
    protected override stripe() {
      return provider;
    }
  }
  const client = new Client(
    componentsGeneric().betterStripe as unknown as Component,
    {
      STRIPE_SECRET_KEY: "sk_test_descriptor_inheritance_synthetic",
      statementDescriptorSuffix: "PLATFORM",
    },
  );
  const ctx: RunCtx = {
    runQuery: vi
      .fn()
      .mockImplementation(async (_ref, args) =>
        args.stripeProductId
          ? { accountId: state.accountId }
          : { statementDescriptor: state.storeDescriptor },
      ),
  };
  return { client, ctx, requests, state };
}

it("omits the inherited descriptor without reading ambient product or account defaults", async () => {
  const f = fixture();
  const input = {
    stripeProductId: "prod_original",
    name: "OriginalEdit",
    inheritStatementDescriptor: false,
    idempotencyKey: "descriptor-omission:original",
  };
  await f.client.updateProduct(f.ctx, input);
  expect(
    new URLSearchParams(f.requests[0]?.form).has("statement_descriptor"),
    f.requests[0]?.form,
  ).toBe(false);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
  expect(f.requests).toEqual([
    {
      path: "/v1/products/prod_original",
      key: "descriptor-omission:original",
      form: "name=OriginalEdit",
    },
  ]);
});

it.each(["  EXPLICIT STORE  ", null])(
  "keeps explicit descriptor %j precedence with inheritance disabled",
  async (statementDescriptor) => {
    const f = fixture();
    const input = {
      stripeProductId: "prod_original",
      inheritStatementDescriptor: false,
      statementDescriptor,
    };
    await f.client.updateProduct(f.ctx, input);
    expect(f.requests).toHaveLength(1);
    expect(
      new URLSearchParams(f.requests[0]?.form).get("statement_descriptor"),
    ).toBe(statementDescriptor === null ? "" : "EXPLICIT STORE");
    expect(f.ctx.runQuery).not.toHaveBeenCalled();
  },
);

it("rejects an invalid explicit descriptor before HTTP or ambient reads when inheritance is disabled", async () => {
  const f = fixture();
  const input = {
    stripeProductId: "prod_original",
    inheritStatementDescriptor: false,
    statementDescriptor: "BAD*NAME",
  };
  await expect(f.client.updateProduct(f.ctx, input)).rejects.toThrow(
    /statement descriptor/i,
  );
  expect(f.requests).toHaveLength(0);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
});

it.each(
  [undefined, true].flatMap((inheritStatementDescriptor) =>
    [undefined, "LEGACY STORE"].map((storeDescriptor) => ({
      inheritStatementDescriptor,
      storeDescriptor,
    })),
  ),
)(
  "keeps legacy inheritance $inheritStatementDescriptor and fallback $storeDescriptor",
  async ({ inheritStatementDescriptor, storeDescriptor }) => {
    const f = fixture();
    f.state.storeDescriptor = storeDescriptor;
    const input = {
      stripeProductId: "prod_original",
      ...(inheritStatementDescriptor === undefined
        ? {}
        : { inheritStatementDescriptor }),
    };
    await f.client.updateProduct(f.ctx, input);
    expect(f.ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(
      new URLSearchParams(f.requests[0]?.form).get("statement_descriptor"),
    ).toBe(storeDescriptor ?? "PLATFORM");
  },
);

it("reuses identical immutable input and key after a lost reply despite ambient retargeting", async () => {
  const f = fixture();
  const input = Object.freeze({
    stripeProductId: "prod_original",
    name: "OriginalEdit",
    metadata: Object.freeze({ communityId: "original" }),
    inheritStatementDescriptor: false,
    idempotencyKey: "descriptor-omission:original",
  });
  f.state.hasLostReply = true;
  await expect(f.client.updateProduct(f.ctx, input)).rejects.toBeInstanceOf(
    Stripe.errors.StripeConnectionError,
  );
  f.state.hasLostReply = false;
  f.state.accountId = "acct_retargeted";
  f.state.storeDescriptor = "RETARGETED STORE";
  await f.client.updateProduct(f.ctx, input);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]).toEqual(f.requests[0]);
  expect(f.requests[0]?.key).toBe(input.idempotencyKey);
  expect(
    new URLSearchParams(f.requests[0]?.form).has("statement_descriptor"),
  ).toBe(false);
  expect(
    new URLSearchParams(f.requests[0]?.form).get("metadata[communityId]"),
  ).toBe("original");
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
});

it("keeps independent original products and caller keys separate", async () => {
  const f = fixture();
  for (const suffix of ["one", "two"]) {
    const input = {
      stripeProductId: `prod_${suffix}`,
      name: `Plan${suffix}`,
      inheritStatementDescriptor: false,
      idempotencyKey: `descriptor-omission:${suffix}`,
    };
    await f.client.updateProduct(f.ctx, input);
  }
  expect(f.requests.map(({ path, key, form }) => [path, key, form])).toEqual([
    ["/v1/products/prod_one", "descriptor-omission:one", "name=Planone"],
    ["/v1/products/prod_two", "descriptor-omission:two", "name=Plantwo"],
  ]);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
});

it.each([400, 409, 500])(
  "preserves HTTP%i and the original omission/key with one transport attempt",
  async (status) => {
    const f = fixture();
    f.state.failure = {
      status,
      type: status === 500 ? "api_error" : "idempotency_error",
      code: status === 409 ? "idempotency_key_in_use" : undefined,
    };
    const input = {
      stripeProductId: "prod_original",
      name: "OriginalEdit",
      inheritStatementDescriptor: false,
      idempotencyKey: "descriptor-omission:error",
    };
    const result = f.client.updateProduct(f.ctx, input);
    await expect(result).rejects.toBeInstanceOf(
      status === 400
        ? Stripe.errors.StripeIdempotencyError
        : Stripe.errors.StripeAPIError,
    );
    await expect(result).rejects.toMatchObject({
      statusCode: status,
      code: status === 409 ? "idempotency_key_in_use" : undefined,
    });
    expect(f.requests).toEqual([
      {
        path: "/v1/products/prod_original",
        key: "descriptor-omission:error",
        form: "name=OriginalEdit",
      },
    ]);
    expect(f.ctx.runQuery).not.toHaveBeenCalled();
  },
);

it("exposes only an optional boolean on the public update type", () => {
  type Input = Parameters<BetterStripe["updateProduct"]>[1];
  expectTypeOf<Input>()
    .toHaveProperty("inheritStatementDescriptor")
    .toEqualTypeOf<boolean | undefined>();
  expectTypeOf<{
    stripeProductId: string;
    inheritStatementDescriptor: string;
  }>().not.toExtend<Input>();
  expectTypeOf<
    Parameters<BetterStripe["createProduct"]>[1]
  >().not.toHaveProperty("inheritStatementDescriptor");
  expectTypeOf<
    Parameters<BetterStripe["deactivateProduct"]>[1]
  >().not.toHaveProperty("inheritStatementDescriptor");
});
