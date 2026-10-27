import { describe, expect, it, vi, afterEach } from "vitest";
import Stripe from "stripe";
import { SingleAttemptHttpClient } from "../../singleAttemptHttpClient.js";
import {
  fixture,
  API_VERSION,
  alter,
} from "../../../../tests/renewalAggregate/fixtures.js";
import {
  readRenewalPriceReplacementContext,
  prepareRenewalScheduleAttachment,
} from "./index.js";
import { binding } from "../renewalAggregate/shared.js";

type Wire = {
  path: string;
  method: string;
  headers: Parameters<Stripe.HttpClient["makeRequest"]>[4];
  body: string;
};
function harness(
  options: {
    sub?: unknown;
    customer?: unknown;
    target?: unknown;
    coupon?: (id: string) => unknown;
    fail?: string;
  } = {},
) {
  const f = fixture();
  const wires: Wire[] = [];
  const sub = structuredClone(
    options.sub ?? f.subscription,
  ) as typeof f.subscription;
  const coupons = new Map<string, unknown>();
  for (const d of [...f.subscription.discounts, ...f.originalItem.discounts])
    coupons.set(d.source.coupon.id, d.source.coupon);
  const delegate = {
    getClientName: () => "controlled-renewal-reader",
    async makeRequest(...args: Parameters<Stripe.HttpClient["makeRequest"]>) {
      const wire = {
        path: args[2],
        method: args[3],
        headers: args[4],
        body: args[5],
      };
      wires.push(wire);
      if (options.fail && wire.path.startsWith(options.fail))
        throw Object.assign(new Error("controlled closed response"), {
          code: "ECONNRESET",
        });
      const url = new URL(wire.path, "https://api.stripe.com");
      const data =
        url.pathname === "/v1/subscriptions/sub_original"
          ? sub
          : url.pathname === "/v1/prices/price_target"
            ? (options.target ?? f.targetPrice)
            : url.pathname === "/v1/customers/cus_buyer"
              ? (options.customer ?? f.billingCustomer)
              : url.pathname.startsWith("/v1/coupons/")
                ? (options.coupon?.(
                    decodeURIComponent(url.pathname.slice(12)),
                  ) ?? coupons.get(decodeURIComponent(url.pathname.slice(12))))
                : (() => {
                    throw Error("unplanned request");
                  })();
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({
          "request-id": "req_controlled",
          "stripe-version": API_VERSION,
        }),
        toJSON: async () => structuredClone(data),
        getRawResponse: () => ({ statusCode: 200 }),
        toStream: () => {
          throw Error("not used");
        },
      } as unknown as Stripe.HttpClientResponse;
    },
  };
  const stripe = new Stripe("sk_test_CONTROLLED", {
    apiVersion: API_VERSION,
    maxNetworkRetries: 0,
    httpClient: new SingleAttemptHttpClient(delegate),
  });
  return {
    f,
    wires,
    stripe,
    read: () =>
      readRenewalPriceReplacementContext(
        stripe,
        { expected: f.prepared.expected },
        API_VERSION,
      ),
  };
}
afterEach(() => vi.restoreAllMocks());
describe("actual SDK renewal context acquisition", () => {
  it("uses fixed bounded GET plan, joins coupons and returns complete snapshots", async () => {
    const h = harness();
    vi.spyOn(Date, "now").mockReturnValue(h.f.preflightInput.observedAt * 1000);
    const result = await h.read();
    expect(result).toMatchObject({
      version: 1,
      scope: "platform",
      apiVersion: API_VERSION,
      readProfile: "renewal-context-v1",
      providerQualification: "required",
      observedAt: h.f.preflightInput.observedAt,
      subscription: h.f.subscription,
      targetPrice: h.f.targetPrice,
      billingCustomer: h.f.billingCustomer,
    });
    expect(
      h.wires.map((w) => new URL(w.path, "https://api.stripe.com").pathname),
    ).toEqual([
      "/v1/subscriptions/sub_original",
      "/v1/prices/price_target",
      "/v1/customers/cus_buyer",
      "/v1/coupons/custom-subscription-offer",
      "/v1/coupons/custom-item-offer",
    ]);
    expect(
      Array.from(
        new URL(
          h.wires[0].path,
          "https://api.stripe.com",
        ).searchParams.values(),
      ),
    ).toEqual(["discounts", "items.data.discounts", "items.data.price"]);
    for (const w of h.wires) {
      expect(w.method).toBe("GET");
      expect(w.body).toBe("");
      expect(w.headers["Stripe-Version"]).toBe(API_VERSION);
      expect(w.headers["Stripe-Account"]).toBeUndefined();
      expect(w.headers["Stripe-Context"]).toBeUndefined();
      expect(w.headers["Idempotency-Key"]).toBeUndefined();
    }
    expect(h.wires.slice(1).every((w) => !w.path.includes("?"))).toBe(true);
  });
  it("performs explicit coupon GET joins when refs are strings, never deep expansion", async () => {
    const f = fixture();
    const sub = alter(
      alter(
        f.subscription,
        ["discounts", 0, "source", "coupon"],
        "custom-subscription-offer",
      ),
      ["items", "data", 0, "discounts", 0, "source", "coupon"],
      "custom-item-offer",
    );
    const h = harness({ sub });
    expect((await h.read()).subscription).toEqual(f.subscription);
    expect(h.wires).toHaveLength(5);
  });
  it("deduplicates coupon IDs while retaining independent discount ownership/order", async () => {
    const f = fixture();
    const sub = alter(
      f.subscription,
      ["items", "data", 0, "discounts", 0, "source", "coupon"],
      f.subscription.discounts[0].source.coupon,
    );
    const h = harness({ sub });
    const result = await h.read();
    expect(h.wires).toHaveLength(4);
    expect(result.subscription.items.data[0].discounts[0].id).toBe("di_item");
  });
  it("retains actual nonnull schedule association without adopting it or fabricating null", async () => {
    const h = harness({
      sub: { ...fixture().subscription, schedule: "sub_sched_observed" },
    });
    expect((await h.read()).subscription.schedule).toBe("sub_sched_observed");
    expect(h.wires.every((w) => w.method === "GET")).toBe(true);
  });
  it.each([
    [
      "foreign subscription",
      () => harness({ sub: { ...fixture().subscription, id: "sub_foreign" } }),
    ],
    [
      "truncated item list",
      () =>
        harness({
          sub: alter(fixture().subscription, ["items", "has_more"], true),
        }),
    ],
    [
      "foreign target",
      () =>
        harness({ target: { ...fixture().targetPrice, id: "price_foreign" } }),
    ],
    [
      "foreign customer",
      () =>
        harness({
          customer: {
            ...fixture().billingCustomer,
            customer_account: "acct_foreign",
          },
        }),
    ],
    [
      "unexpanded discount",
      () =>
        harness({
          sub: alter(
            fixture().subscription,
            ["discounts"],
            ["di_subscription"],
          ),
        }),
    ],
    [
      "promotion source",
      () =>
        harness({
          sub: alter(
            fixture().subscription,
            ["discounts", 0, "source", "type"],
            "promotion_code",
          ),
        }),
    ],
    [
      "wrong coupon",
      () =>
        harness({
          coupon: () => ({
            id: "foreign",
            object: "coupon",
            duration: "forever",
            livemode: false,
          }),
        }),
    ],
    [
      "deleted coupon",
      () =>
        harness({
          coupon: (id: string) => ({ id, object: "coupon", deleted: true }),
        }),
    ],
    [
      "foreign coupon mode",
      () =>
        harness({
          coupon: (id: string) => ({
            id,
            object: "coupon",
            livemode: true,
            duration: "forever",
          }),
        }),
    ],
  ])("rejects %s without POST or alternate fallback", async (_label, build) => {
    const h = build();
    await expect(h.read()).rejects.toThrow();
    expect(h.wires.every((w) => w.method === "GET")).toBe(true);
  });
  it("does not overwrite contradictory expanded coupon mode with a later join", async () => {
    const h = harness({
      sub: alter(
        fixture().subscription,
        ["discounts", 0, "source", "coupon", "livemode"],
        true,
      ),
    });
    await expect(h.read()).rejects.toThrow();
    expect(
      h.wires.filter((w) => w.path.startsWith("/v1/coupons/")),
    ).toHaveLength(0);
  });
  it("does not retry closed connections or fall back after planned read fails", async () => {
    const h = harness({ fail: "/v1/coupons/" });
    await expect(h.read()).rejects.toThrow();
    expect(
      h.wires.filter((w) => w.path.startsWith("/v1/coupons/")),
    ).toHaveLength(1);
    expect(h.wires).toHaveLength(4);
  });
  it("rejects unqualified API before reading", async () => {
    const h = harness();
    await expect(
      readRenewalPriceReplacementContext(
        h.stripe,
        { expected: h.f.prepared.expected },
        "2025-03-31.basil",
      ),
    ).rejects.toThrow();
    expect(h.wires).toHaveLength(0);
  });
});
describe("pure retained attach request", () => {
  function options() {
    const f = fixture();
    return {
      prepared: f.prepared,
      apiVersion: API_VERSION,
      attachKey: "caller:attach",
      firstDispatchedAt: f.preflightInput.observedAt,
    };
  }
  it("binds the exact full stage request with no mutating provider capability", () => {
    const o = options();
    const r = prepareRenewalScheduleAttachment(o);
    const { requestIdentity, ...unsigned } = r;
    expect(unsigned).toEqual({
      version: 1,
      stage: "attach",
      scope: "platform",
      apiVersion: API_VERSION,
      logicalBinding: o.prepared.requestIdentity.binding,
      method: "POST",
      path: "/v1/subscription_schedules",
      payload: { from_subscription: "sub_original" },
      key: o.attachKey,
      firstDispatchedAt: o.firstDispatchedAt,
    });
    expect(requestIdentity).toEqual({
      key: o.attachKey,
      binding: binding("renewal-attach", unsigned),
    });
  });
  it("permits explicit caller choice of same logical and attach key; never derives one", () => {
    const o = options();
    o.attachKey = o.prepared.requestIdentity.key;
    expect(prepareRenewalScheduleAttachment(o).key).toBe(o.attachKey);
  });
  it.each(["", "x\ny", "x".repeat(256)])(
    "rejects invalid explicit key",
    (key) =>
      expect(() =>
        prepareRenewalScheduleAttachment({ ...options(), attachKey: key }),
      ).toThrow(),
  );
  it("rejects forged preparation and arbitrary create options", () => {
    expect(() =>
      prepareRenewalScheduleAttachment({
        ...options(),
        prepared: { ...options().prepared, quantity: 9 },
      }),
    ).toThrow();
    expect(() =>
      (prepareRenewalScheduleAttachment as (value: unknown) => unknown)({
        ...options(),
        metadata: { unexpected: "yes" },
      }),
    ).toThrow();
  });
  it("rejects missing key/time and wrong API without generating replacement", () => {
    const invalid = prepareRenewalScheduleAttachment as (
      value: unknown,
    ) => unknown;
    const o = options();
    for (const x of [
      { ...o, attachKey: undefined },
      { ...o, firstDispatchedAt: undefined },
      { ...o, firstDispatchedAt: -1 },
      { ...o, apiVersion: "unknown" },
    ])
      expect(() => invalid(x)).toThrow();
  });
});

describe("public server SDK placement", () => {
  it("exposes actual class reader and pure builder, selecting single-attempt client", async () => {
    const publicApi = await import("../../index.js");
    expect(publicApi.prepareRenewalPriceReplacement).toBeTypeOf("function");
    const helpers = await import("../../helpers.js");
    const h = harness();
    const selected = vi
      .spyOn(helpers, "getStripeClient")
      .mockReturnValue(h.stripe);
    const client = new publicApi.BetterStripe(
      {} as ConstructorParameters<typeof publicApi.BetterStripe>[0],
      {
        STRIPE_SECRET_KEY: "sk_test_CONTROLLED",
        stripeApiVersion: API_VERSION,
      },
    );
    const reader = (
      client as unknown as {
        readRenewalPriceReplacementContext: (
          ctx: unknown,
          opts: unknown,
        ) => Promise<unknown>;
      }
    ).readRenewalPriceReplacementContext;
    expect(typeof reader).toBe("function");
    await reader.call(client, {}, { expected: h.f.prepared.expected });
    expect(selected).toHaveBeenCalledWith("sk_test_CONTROLLED", API_VERSION, {
      singleAttempt: true,
    });
    const exported = (
      publicApi as unknown as {
        prepareRenewalScheduleAttachment: typeof prepareRenewalScheduleAttachment;
      }
    ).prepareRenewalScheduleAttachment;
    expect(
      exported({
        prepared: h.f.prepared,
        apiVersion: API_VERSION,
        attachKey: "caller:public",
        firstDispatchedAt: h.f.preflightInput.observedAt,
      }).key,
    ).toBe("caller:public");
  });
});
