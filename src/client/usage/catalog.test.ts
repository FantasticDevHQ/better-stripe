import Stripe from "stripe";
import { convexToJson } from "convex/values";
import { CatalogClient } from "../products/catalogClient.js";
import { getUsagePriceBinding } from "./catalogRead.js";
import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";
import schema from "../../component/schema.js";
import { modules } from "../../test.js";
import { initConvexTest } from "../setup.test.js";
import type { Component, RunCtx } from "../helpers.js";
import { defineUsagePlan } from "./contracts.js";
import { ensureUsageMeter, ensureUsagePrice } from "./catalog.js";
import {
  adoptUsageMeter,
  getUsageMeterFromStripe,
  listStripeUsageMeters,
  setUsageMeterActive,
} from "./catalogLifecycle.js";
import { STRIPE_API_VERSION } from "../constants.js";
const scope = { stripeAccountId: "acct_platform", livemode: false };
const plan = defineUsagePlan({
  key: "calls",
  version: "v1",
  model: "pay_as_you_go",
  unit: { name: "call", precision: 2 },
  rate: { currency: "usd", unitAmountDecimal: "2" },
});
function setup() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = componentsGeneric().betterStripe as unknown as Component;
  const meters = new Map<string, Record<string, unknown>>(),
    prices = new Map<string, Record<string, unknown>>();
  const requests: Array<{
    method: string;
    path: string;
    body: URLSearchParams;
    key: string | null;
  }> = [];
  const control = { failComplete: false, wrongRealm: false };
  const stripe = new Stripe("sk_test_catalog", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = new URLSearchParams(String(init?.body ?? ""));
      requests.push({
        method,
        path: url.pathname,
        body,
        key: new Headers(init?.headers).get("idempotency-key"),
      });
      let result: unknown;
      if (url.pathname === "/v1/account")
        result = { id: control.wrongRealm ? "acct_other" : "acct_platform" };
      else if (url.pathname === "/v1/balance")
        result = {
          livemode: false,
          object: "balance",
          available: [],
          pending: [],
        };
      else if (url.pathname === "/v1/billing/meters" && method === "GET")
        result = {
          object: "list",
          data: [...meters.values()],
          has_more: false,
        };
      else if (url.pathname === "/v1/billing/meters" && method === "POST") {
        const id = `mtr_${meters.size + 1}`;
        result = {
          id,
          object: "billing.meter",
          event_name: body.get("event_name"),
          display_name: body.get("display_name"),
          default_aggregation: {
            formula: body.get("default_aggregation[formula]"),
          },
          customer_mapping: {
            type: "by_id",
            event_payload_key: "stripe_customer_id",
          },
          value_settings: { event_payload_key: "value" },
          event_time_window: null,
          livemode: false,
          status: "active",
        };
        meters.set(id, result as Record<string, unknown>);
      } else if (url.pathname.startsWith("/v1/billing/meters/")) {
        const parts = url.pathname.split("/");
        const meter = meters.get(parts[4]);
        if (meter && method === "POST")
          meter.status = parts[5] === "reactivate" ? "active" : "inactive";
        result = meter;
      } else if (url.pathname === "/v1/products/prod_calls")
        result = {
          id: "prod_calls",
          object: "product",
          active: true,
          name: "Calls",
        };
      else if (url.pathname.startsWith("/v1/prices/"))
        result = prices.get(url.pathname.split("/").slice(-1)[0]);
      else if (url.pathname === "/v1/prices" && method === "GET")
        result = {
          object: "list",
          data: [...prices.values()].filter(
            (p) => p.lookup_key === url.searchParams.get("lookup_keys[0]"),
          ),
          has_more: false,
        };
      else if (url.pathname === "/v1/prices" && method === "POST") {
        const id = `price_${prices.size + 1}`;
        const tiered = body.get("billing_scheme") === "tiered";
        result = {
          id,
          object: "price",
          product: "prod_calls",
          lookup_key: body.get("lookup_key"),
          active: true,
          livemode: false,
          type: "recurring",
          currency: body.get("currency"),
          billing_scheme: body.get("billing_scheme"),
          transform_quantity: null,
          unit_amount_decimal: body.get("unit_amount_decimal"),
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "metered",
            meter: body.get("recurring[meter]"),
          },
          tiers_mode: tiered ? "graduated" : null,
          tiers: tiered
            ? [
                {
                  up_to: Number(body.get("tiers[0][up_to]")),
                  unit_amount_decimal: body.get(
                    "tiers[0][unit_amount_decimal]",
                  ),
                  flat_amount: null,
                  flat_amount_decimal: null,
                },
                {
                  up_to: null,
                  unit_amount_decimal: body.get(
                    "tiers[1][unit_amount_decimal]",
                  ),
                  flat_amount: null,
                  flat_amount_decimal: null,
                },
              ]
            : undefined,
        };
        prices.set(id, result as Record<string, unknown>);
      } else result = { error: { message: "Unexpected fixture request" } };
      return new Response(JSON.stringify(result), {
        status: result ? 200 : 404,
        headers: {
          "content-type": "application/json",
          "request-id": "req_fixture",
        },
      });
    }),
  });
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => {
      if (control.failComplete && args.providerId) {
        control.failComplete = false;
        throw new Error("Mirror unavailable");
      }
      return t.mutation(ref, args);
    },
  } as RunCtx;
  return { t, component, ctx, stripe, requests, meters, prices, control };
}
it("repairs provider-success/mirror-failure without duplicate native resources", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  f.control.failComplete = true;
  await expect(
    ensureUsageMeter(f.stripe, f.component, f.ctx, opts),
  ).rejects.toThrow("Mirror unavailable");
  const meter = await ensureUsageMeter(f.stripe, f.component, f.ctx, opts);
  expect(f.meters.size).toBe(1);
  expect(meter.id).toBe("mtr_1");
  const priceOpts = {
    scope,
    plan,
    meterId: meter.id,
    stripeProductId: "prod_calls",
    lookupKey: "calls_v1",
  };
  f.control.failComplete = true;
  await expect(
    ensureUsagePrice(f.stripe, f.component, f.ctx, priceOpts),
  ).rejects.toThrow("Mirror unavailable");
  const price = await ensureUsagePrice(f.stripe, f.component, f.ctx, priceOpts);
  expect(f.prices.size).toBe(1);
  expect(
    await getUsagePriceBinding(f.component, f.ctx, {
      scope,
      lookupKey: "calls_v1",
    }),
  ).toMatchObject({
    status: "available",
    value: {
      pricingMode: "metered",
      unitAmountDecimal: "0.02",
      billingScheme: "per_unit",
    },
  });
  expect(
    await getUsagePriceBinding(f.component, f.ctx, {
      scope: { ...scope, stripeAccountId: "acct_other" },
      lookupKey: "calls_v1",
    }),
  ).toMatchObject({ status: "unavailable" });

  expect(price.unit_amount_decimal?.toString()).toBe("0.02");
  for (const request of f.requests.filter((r) => r.method === "POST"))
    expect(request.key).toMatch(/^bs_usage_/);
});
it.each(["included_overage", "prepaid"])(
  "provisions exact native %s pricing",
  async (model) => {
    const f = setup();
    const terms = defineUsagePlan({
      ...plan,
      model,
      ...(model === "included_overage"
        ? { includedQuantity: "10", reset: "billing_period" }
        : { insufficientBalance: "reject" }),
    });
    const meter = await ensureUsageMeter(f.stripe, f.component, f.ctx, {
      scope,
      plan: terms,
      eventName: "calls_v1",
      displayName: "Calls",
    });
    const price = await ensureUsagePrice(f.stripe, f.component, f.ctx, {
      scope,
      plan: terms,
      meterId: meter.id,
      stripeProductId: "prod_calls",
      lookupKey: "calls_v1",
    });
    expect(price.recurring?.usage_type).toBe("metered");
    if (model === "included_overage")
      expect(
        price.tiers?.map((tier) => ({
          up_to: tier.up_to,
          unit_amount_decimal: tier.unit_amount_decimal?.toString(),
        })),
      ).toMatchObject([
        { up_to: 1000, unit_amount_decimal: "0" },
        { up_to: null, unit_amount_decimal: "0.02" },
      ]);
  },
);
it("rejects scope and immutable term changes before duplicate provisioning", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  await ensureUsageMeter(f.stripe, f.component, f.ctx, opts);
  await expect(
    ensureUsageMeter(f.stripe, f.component, f.ctx, {
      ...opts,
      eventName: "changed",
    }),
  ).rejects.toThrow();
  f.control.wrongRealm = true;
  await expect(
    ensureUsageMeter(f.stripe, f.component, f.ctx, {
      ...opts,
      plan: { ...plan, version: "v2" },
    }),
  ).rejects.toThrow();
  expect(f.meters.size).toBe(1);
});

it("never recreates a pinned meter when provider discovery stops returning it", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  await ensureUsageMeter(f.stripe, f.component, f.ctx, opts);
  f.meters.clear();
  await expect(
    ensureUsageMeter(f.stripe, f.component, f.ctx, opts),
  ).rejects.toThrow();
  expect(
    f.requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/billing/meters",
    ),
  ).toHaveLength(1);
});

it("rejects changed provider pricing and ambiguous discovery", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  const meter = await ensureUsageMeter(f.stripe, f.component, f.ctx, opts);
  const priceOpts = {
    scope,
    plan,
    meterId: meter.id,
    stripeProductId: "prod_calls",
    lookupKey: "calls_v1",
  };
  await ensureUsagePrice(f.stripe, f.component, f.ctx, priceOpts);
  const price = [...f.prices.values()][0];
  price.unit_amount_decimal = "99";
  await expect(
    ensureUsagePrice(f.stripe, f.component, f.ctx, priceOpts),
  ).rejects.toThrow("incompatible immutable terms");
  const second = setup();
  second.meters.set("mtr_1", { ...f.meters.get(meter.id), id: "mtr_1" });
  second.meters.set("mtr_2", { ...f.meters.get(meter.id), id: "mtr_2" });
  await expect(
    ensureUsageMeter(second.stripe, second.component, second.ctx, opts),
  ).rejects.toThrow("ambiguous");
  expect(second.requests.filter((r) => r.method === "POST")).toEqual([]);
});

it("adopts, retrieves, pages and explicitly deactivates/reactivates native meters", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  const meter = await ensureUsageMeter(f.stripe, f.component, f.ctx, opts);
  expect(
    (
      await adoptUsageMeter(f.stripe, f.component, f.ctx, {
        ...opts,
        meterId: meter.id,
      })
    ).id,
  ).toBe(meter.id);
  expect(
    (await getUsageMeterFromStripe(f.stripe, { scope, meterId: meter.id })).id,
  ).toBe(meter.id);
  expect(
    await listStripeUsageMeters(f.stripe, { scope, limit: 10 }),
  ).toMatchObject({ data: [{ id: meter.id }], hasMore: false, cursor: null });
  expect(
    (
      await setUsageMeterActive(f.stripe, f.component, f.ctx, {
        scope,
        meterId: meter.id,
        active: false,
      })
    ).status,
  ).toBe("inactive");
  await expect(
    ensureUsageMeter(f.stripe, f.component, f.ctx, opts),
  ).rejects.toThrow();
  expect(
    (
      await setUsageMeterActive(f.stripe, f.component, f.ctx, {
        scope,
        meterId: meter.id,
        active: true,
      })
    ).status,
  ).toBe("active");
  expect(
    f.requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/billing/meters",
    ),
  ).toHaveLength(1);
  await expect(
    listStripeUsageMeters(f.stripe, { scope, limit: 101 }),
  ).rejects.toThrow();
});

it("holds unresolved creation after its safe provider retry window", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  f.control.failComplete = true;
  await expect(
    ensureUsageMeter(f.stripe, f.component, f.ctx, opts),
  ).rejects.toThrow("Mirror unavailable");
  f.meters.clear();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 24 * 3600 * 1000);
  try {
    await expect(
      ensureUsageMeter(f.stripe, f.component, f.ctx, opts),
    ).rejects.toThrow("safe retry window");
  } finally {
    clock.mockRestore();
  }
  expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it("rejects adoption that reassigns an already bound native meter", async () => {
  const f = setup();
  const opts = { scope, plan, eventName: "calls_v1", displayName: "Calls" };
  const meter = await ensureUsageMeter(f.stripe, f.component, f.ctx, opts);
  await expect(
    adoptUsageMeter(f.stripe, f.component, f.ctx, {
      ...opts,
      plan: { ...plan, version: "v2" },
      meterId: meter.id,
    }),
  ).rejects.toThrow("ownership conflict");
});

it("returns a plain Convex-safe public price binding instead of SDK Decimal objects", async () => {
  const f = setup();
  class Client extends CatalogClient {
    get statementDescriptorSuffix() {
      return undefined;
    }
    protected stripe() {
      return f.stripe;
    }
  }
  const sdk = new Client(f.component);
  const meter = await sdk.ensureUsageMeter(f.ctx, {
    scope,
    plan,
    eventName: "calls_v1",
    displayName: "Calls",
  });
  const price = await sdk.ensureUsagePrice(f.ctx, {
    scope,
    plan,
    meterId: meter.id,
    stripeProductId: "prod_calls",
    lookupKey: "calls_v1",
  });
  expect(price).toMatchObject({
    pricingMode: "metered",
    stripePriceId: "price_1",
    unitAmountDecimal: "0.02",
  });
  expect(() => convexToJson(price)).not.toThrow();
});
