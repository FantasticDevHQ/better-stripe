import { it, expect } from "vitest";
import Stripe from "stripe";
import { SingleAttemptHttpClient } from "../../singleAttemptHttpClient.js";
import {
  fixture,
  API_VERSION,
} from "../../../../tests/renewalAggregate/fixtures.js";
import { readRenewalPriceReplacementContext } from "./reader.js";
import { readRenewalWireJSON } from "./wireJson.js";
export function wireHarness(status = 200, withDecimals = true) {
  const f = fixture();
  const sub = JSON.parse(JSON.stringify(f.subscription));
  const p = {
    ...sub.items.data[0].price,
    unit_amount: 1000,
    unit_amount_decimal: withDecimals ? "1000.00" : null,
    created: 1,
    metadata: { keep: "wire" },
    nickname: null,
    tiers_mode: null,
    transform_quantity: null,
  };
  sub.items.data[0].price = p;
  sub.items.data[0].plan = {
    id: p.id,
    object: "plan",
    active: p.active,
    amount: 1000,
    amount_decimal: withDecimals ? "1000.00" : null,
    billing_scheme: p.billing_scheme,
    created: 1,
    currency: p.currency,
    interval: p.recurring.interval,
    interval_count: p.recurring.interval_count,
    livemode: p.livemode,
    metadata: { keep: "wire" },
    meter: null,
    nickname: null,
    product: p.product,
    tiers_mode: null,
    transform_usage: null,
    trial_period_days: null,
    usage_type: "licensed",
  };
  sub.opaque = { facts: ["keep", "all"] };
  const target = {
    ...f.targetPrice,
    unit_amount_decimal: withDecimals ? "2000.00" : null,
    opaque: { keep: "yes" },
  };
  const calls: {
    path: string;
    method: string;
    version: string | null;
    connected: string | null;
    body: string;
  }[] = [];
  const coupons = new Map(
    [...f.subscription.discounts, ...f.originalItem.discounts].map((d) => [
      d.source.coupon.id,
      d.source.coupon,
    ]),
  );
  const stripe = new Stripe("sk_test_ONLY_CONTROLLED_WIRE", {
    apiVersion: API_VERSION,
    maxNetworkRetries: 0,
    httpClient: new SingleAttemptHttpClient(
      Stripe.createFetchHttpClient(async (url, init) => {
        const u = new URL(String(url)),
          headers = new Headers(init?.headers);
        calls.push({
          path: u.pathname + u.search,
          method: String(init?.method),
          version: headers.get("stripe-version"),
          connected: headers.get("stripe-account"),
          body: String(init?.body ?? ""),
        });
        const body = u.pathname.startsWith("/v1/subscriptions/")
          ? sub
          : u.pathname.startsWith("/v1/prices/")
            ? target
            : u.pathname.startsWith("/v1/customers/")
              ? f.billingCustomer
              : coupons.get(decodeURIComponent(u.pathname.slice(12)));
        return new Response(JSON.stringify(body), {
          status,
          headers: {
            "content-type": "application/json",
            "request-id": "req_controlledwire",
            "stripe-version": API_VERSION,
          },
        });
      }),
    ),
  });
  return {
    f,
    sub,
    target,
    calls,
    stripe,
    read: () =>
      readRenewalPriceReplacementContext(
        stripe,
        { expected: f.prepared.expected },
        API_VERSION,
      ),
  };
}
it("reader preserves actualSDK nativePlan/Price decimal stringlexemes and every opaqueJSONfact", async () => {
  const h = wireHarness();
  const r = await h.read();
  expect(
    (
      (r.subscription.items.data[0] as Record<string, unknown>).plan as {
        amount_decimal: string;
      }
    ).amount_decimal,
  ).toBe("1000.00");
  expect(r.subscription.items.data[0].price.unit_amount_decimal).toBe(
    "1000.00",
  );
  expect(r.subscription).toEqual(h.sub);
  expect(r.targetPrice).toEqual(h.target);
  expect(h.calls).toHaveLength(5);
  expect(
    h.calls.every(
      (c) =>
        c.method === "GET" &&
        c.version === API_VERSION &&
        c.connected === null &&
        c.body === "",
    ),
  ).toBe(true);
  const first = new URL(h.calls[0].path, "https://api.stripe.com");
  expect([...first.searchParams]).toEqual([
    ["expand[0]", "discounts"],
    ["expand[1]", "items.data.discounts"],
    ["expand[2]", "items.data.price"],
  ]);
});
it.each([201, 204, 299])(
  "admitsvalid2xx JSON or failsclosed onbodyless%s",
  async (status) => {
    // 201/299 are valid2xx. The fixedbody stillneeds schema; unlike204 they preserveJSON.
    const h = wireHarness(status);
    if (status === 204) await expect(h.read()).rejects.toBeDefined();
    else expect((await h.read()).subscription.id).toBe("sub_original");
  },
);
it.each([307, 308, 400, 500])(
  "rejects fulfillednon2xx JSONstatus%s before acquiring otherresources",
  async (status) => {
    const h = wireHarness(status, false);
    await expect(h.read()).rejects.toBeDefined();
    expect(h.calls).toHaveLength(1);
  },
);

it.each([
  {},
  { status: "200" },
  { statusCode: "200" },
  { status: 200, statusCode: 201 },
  { status: 200, statusCode: 500 },
  { status: NaN },
])("rejects missing/invalid/contradictory statusmetadata %j", async (meta) => {
  const f = fixture();
  const stripe = new Stripe("sk_test_CONTROLLED_META", {
    apiVersion: API_VERSION,
    maxNetworkRetries: 0,
    httpClient: {
      getClientName: () => "controlledmeta",
      makeRequest: async () => ({
        getStatusCode: () => 200,
        getHeaders: () => ({ "request-id": "req_meta" }),
        getRawResponse: () => meta,
        toJSON: async () => JSON.parse(JSON.stringify(f.billingCustomer)),
        toStream: () => {
          throw Error("unused");
        },
      }),
    },
  });
  await expect(
    readRenewalWireJSON(stripe, "customer", "cus_buyer"),
  ).rejects.toMatchObject({
    message: expect.stringContaining("provider_http_status"),
  });
});
it.each([
  { status: 200 },
  { statusCode: 200 },
  { status: 200, statusCode: 200 },
])("admits supported successfultransportmetadata %j", async (meta) => {
  const f = fixture();
  const stripe = new Stripe("sk_test_CONTROLLED_META_VALID", {
    apiVersion: API_VERSION,
    maxNetworkRetries: 0,
    httpClient: {
      getClientName: () => "controlledmeta",
      makeRequest: async () => ({
        getStatusCode: () => 200,
        getHeaders: () => ({ "request-id": "req_meta" }),
        getRawResponse: () => meta,
        toJSON: async () => JSON.parse(JSON.stringify(f.billingCustomer)),
        toStream: () => {
          throw Error("unused");
        },
      }),
    },
  });
  expect(await readRenewalWireJSON(stripe, "customer", "cus_buyer")).toEqual(
    f.billingCustomer,
  );
});
it("encodes arbitrary supported customcoupon IDs into one fixedpath segment", async () => {
  const paths: string[] = [];
  const stripe = new Stripe("sk_test_CONTROLLED_ENCODE", {
    apiVersion: API_VERSION,
    maxNetworkRetries: 0,
    httpClient: {
      getClientName: () => "controlledencoding",
      makeRequest: async (...args) => {
        paths.push(args[2]);
        return {
          getStatusCode: () => 200,
          getHeaders: () => ({}),
          getRawResponse: () => ({ statusCode: 200 }),
          toJSON: async () => ({ id: "custom /?#%", object: "coupon" }),
          toStream: () => {
            throw Error("unused");
          },
        };
      },
    },
  });
  expect(await readRenewalWireJSON(stripe, "coupon", "custom /?#%")).toEqual({
    id: "custom /?#%",
    object: "coupon",
  });
  expect(paths).toEqual(["/v1/coupons/custom%20%2F%3F%23%25"]);
});

it.each([".", ".."])(
  "rejects dot-only coupon selector %s before actualSDK issues anyrequest",
  async (id) => {
    let requests = 0;
    const stripe = new Stripe("sk_test_CONTROLLED_DOT_SEGMENT", {
      apiVersion: API_VERSION,
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(async () => {
        requests++;
        return new Response(JSON.stringify({ id, object: "coupon" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    await expect(
      readRenewalWireJSON(stripe, "coupon", id),
    ).rejects.toBeDefined();
    expect(requests).toBe(0);
  },
);
