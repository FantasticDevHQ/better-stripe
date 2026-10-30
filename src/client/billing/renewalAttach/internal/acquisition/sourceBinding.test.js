import { afterEach, expect, it, vi } from "vitest";
import { scenario } from "./test-fixtures/scenario.mjs";
afterEach(() => {
  vi.doUnmock("../sourceBindings.js");
  vi.resetModules();
  vi.unstubAllGlobals();
});
it("default unbound Source factory refuses before any I/O", async () => {
  vi.resetModules();
  let calls = 0;
  vi.stubGlobal("fetch", () => {
    calls++;
    throw Error("NETWORK_FORBIDDEN");
  });
  const { createSourceRawAcquisition } = await import("./rawAcquisition.js");
  const { COMPILED_ENTRIES } = await import("../sourceBindings.js");
  expect(COMPILED_ENTRIES).toEqual([]);
  expect(Object.isFrozen(COMPILED_ENTRIES)).toBe(true);
  expect(() => createSourceRawAcquisition()).toThrow("ORIGINAL_OWNER_STOP");
  expect(calls).toBe(0);
});
it("fixed factory rejects foreign arguments without reflecting them", async () => {
  vi.resetModules();
  const { createSourceRawAcquisition } = await import("./rawAcquisition.js");
  let traps = 0;
  const foreign = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error("FOREIGN_ARG");
      },
      getPrototypeOf() {
        traps++;
        throw Error("FOREIGN_ARG");
      },
      ownKeys() {
        traps++;
        throw Error("FOREIGN_ARG");
      },
    },
  );
  expect(() =>
    Reflect.apply(createSourceRawAcquisition, undefined, [foreign]),
  ).toThrow("RAW_ACQUISITION_STOP");
  expect(traps).toBe(0);
});
it("actual stock SingleAttempt decode retains raw bodies and child completion leaves the SAME original owner live", async () => {
  vi.resetModules();
  const s = scenario(),
    wallMs = (s.expected.periodStart + 1) * 1000,
    ns = 1_000_000_000n;
  let samples = 0;
  const paths = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const url = new URL(String(input));
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    paths.push(url.pathname);
    const body = url.pathname.startsWith("/v1/subscriptions/")
      ? s.subscription
      : url.pathname.startsWith("/v1/prices/")
        ? s.targetPrice
        : url.pathname.startsWith("/v1/customers/")
          ? s.billingCustomer
          : s.coupons.get(
              decodeURIComponent(url.pathname.slice("/v1/coupons/".length)),
            );
    expect(body).toBeDefined();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_SYNTHETIC_314",
      },
    });
  });
  const { getStripeClient } = await import("../../../../helpers.js");
  const client = getStripeClient(
    "sk_test_SYNTHETIC_REPO_314_NO_CREDENTIAL",
    "2026-09-30.endive",
    { singleAttempt: true },
  );
  const source = {
    clock: {
      basis: {
        startWallMs: wallMs,
        startNs: ns,
        workEndWallMs: wallMs + 5000,
        workEndNs: ns + 5_000_000_000n,
        endWallMs: wallMs + 8000,
        endNs: ns + 8_000_000_000n,
      },
      sample() {
        samples++;
        return { wallMs, ns };
      },
      subscribeRetirement() {
        return () => {};
      },
    },
    originalPolicy: {
      firstDispatchedAt: s.expected.periodStart + 1,
      periodStart: s.expected.periodStart,
      periodEnd: s.expected.periodEnd,
    },
    originAssociation: Object.freeze({}),
  };
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => source,
    loadFixedStockClient: () => client,
  }));
  const { OWNER } = await import("../originalOwner.js");
  const { createSourceRawAcquisition } = await import("./rawAcquisition.js");
  const basis = OWNER.basis;
  const reader = createSourceRawAcquisition();
  const result = await reader.acquire(s.expected);
  expect(result.ok).toBe(true);
  expect(result.bundle.wireSubscription).toEqual(s.subscription);
  expect(result.bundle.wireTargetPrice).toEqual(s.targetPrice);
  expect(result.bundle.wireBillingCustomer).toEqual(s.billingCustomer);
  expect(paths).toHaveLength(5);
  expect(result.observedAt).toBe(s.expected.periodStart + 1);
  expect(result.sourceFulfillmentEstablished).toBe(false);
  expect(result.clockProvenanceEstablished).toBe(false);
  expect(result.operatorReady).toBe(false);
  expect(OWNER.basis).toBe(basis);
  expect(OWNER.check().retired).toBe(false);
  expect(samples).toBeGreaterThan(paths.length);
  expect(OWNER.check).toBe(OWNER.sample);
  expect(await reader.acquire(s.expected)).toEqual({
    ok: false,
    complete: false,
    code: "RAW_ACQUISITION_STOP",
  });
  expect(paths).toHaveLength(5);
  expect(OWNER.check().retired).toBe(false);
});
