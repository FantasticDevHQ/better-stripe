import Stripe from "stripe";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./sourceBindings.js");
  vi.doUnmock("./originalOwner.js");
  vi.resetModules();
});

async function delegate(client: unknown, check = () => {}) {
  vi.resetModules();
  vi.doMock("./originalOwner.js", () => ({ OWNER: { check } }));
  vi.doMock("./sourceBindings.js", () => ({
    loadFixedStockClient: () => client,
  }));
  return (await import("./stockRawDelegate.js")).createSourceStockRawDelegate;
}

it("captures the inherited stock method and preserves receiver, args and exact promise", async () => {
  const client = new Stripe("sk_test_INTERNAL_SYNTHETIC_ONLY");
  const promise = Promise.resolve({ ordinary: true });
  let receiver: unknown;
  let args: unknown[] = [];
  vi.spyOn(Stripe.prototype, "rawRequest").mockImplementation(function (
    this: Stripe,
    ...values
  ) {
    receiver = this;
    args = values;
    return promise as ReturnType<Stripe["rawRequest"]>;
  });
  const create = await delegate(client);
  let raw: ReturnType<typeof create> | undefined;
  try {
    raw = create();
  } catch {
    /* Fixed STOP scaffold must fail the live assertion. */
  }
  expect(raw).toBeDefined();
  if (!raw) throw new Error("missing live delegate");
  expect(Object.isFrozen(raw)).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(raw, "rawRequest")).toBe(true);
  const options = { maxNetworkRetries: 0, idempotencyKey: "retained" };
  expect(
    raw.rawRequest(
      "POST",
      "/v1/subscription_schedules",
      { from_subscription: "sub_original" },
      options,
    ),
  ).toBe(promise);
  expect(receiver).toBe(client);
  expect(args[3]).toBe(options);
  expect(args).toEqual([
    "POST",
    "/v1/subscription_schedules",
    { from_subscription: "sub_original" },
    options,
  ]);
});

it("forwards the identical synchronous stock throw without retry or wrapping", async () => {
  const client = new Stripe("sk_test_INTERNAL_SYNTHETIC_ONLY"),
    error = Error("SYNTHETIC");
  let calls = 0;
  vi.spyOn(Stripe.prototype, "rawRequest").mockImplementation(() => {
    calls++;
    throw error;
  });
  const create = await delegate(client);
  const raw = create();
  try {
    void raw.rawRequest("GET", "/v1/customers/cus_original");
    expect.fail("must throw");
  } catch (caught) {
    expect(caught).toBe(error);
  }
  expect(calls).toBe(1);
});

it("forwards a real stock SDK request to a closed synthetic HTTP delegate once", async () => {
  const requests: unknown[][] = [];
  const client = new Stripe("sk_test_INTERNAL_SYNTHETIC_ONLY", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      requests.push([url, init?.method, init?.body]);
      return new Response(
        JSON.stringify({
          id: "sub_sched_original",
          object: "subscription_schedule",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  });
  const create = await delegate(client),
    raw = create();
  const result = await raw.rawRequest(
    "POST",
    "/v1/subscription_schedules",
    { from_subscription: "sub_original" },
    { maxNetworkRetries: 0, idempotencyKey: "same-retained-key" },
  );
  expect(result.id).toBe("sub_sched_original");
  expect(requests).toHaveLength(1);
  expect(requests[0][1]).toBe("POST");
  expect(requests[0][2]).toBe("from_subscription=sub_original");
});

it.each(["foreign", "own-method", "proxy"])(
  "refuses %s clients before a raw request",
  async (kind) => {
    const client = new Stripe("sk_test_INTERNAL_SYNTHETIC_ONLY");
    let traps = 0;
    const supplied =
      kind === "foreign"
        ? {}
        : kind === "proxy"
          ? new Proxy(client, {
              getPrototypeOf() {
                traps++;
                return Stripe.prototype;
              },
            })
          : Object.defineProperty(client, "rawRequest", {
              value() {
                throw Error("MUST_NOT_CALL");
              },
            });
    const create = await delegate(supplied);
    expect(() => create()).toThrow("STOCK_SOURCE_DELEGATE_UNBOUND");
    expect(traps).toBe(0);
  },
);

it("checks the owner before loading or inspecting a client and rejects parameters", async () => {
  let gets = 0;
  const client = new Proxy(
    {},
    {
      getPrototypeOf() {
        gets++;
        return null;
      },
    },
  );
  const create = await delegate(client, () => {
    throw Error("RETIRED");
  });
  expect(() => create()).toThrow("RETIRED");
  expect(gets).toBe(0);
  expect(() => Reflect.apply(create, undefined, [client])).toThrow(
    "STOCK_SOURCE_DELEGATE_UNBOUND",
  );
});
