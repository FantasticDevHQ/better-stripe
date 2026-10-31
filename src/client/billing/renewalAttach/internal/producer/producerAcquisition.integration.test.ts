import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import { declaredInputs } from "../test-fixtures/attachEntries.js";
import { INITIAL_NS } from "../test-fixtures/producerInitialDeclarations.js";
import { captureInitialInvocationCore } from "./invocationProducer.js";

const legacy = vi.hoisted(() => ({ touched: 0 }));
vi.mock("../originalOwner.js", () => ({
  OWNER: Object.freeze({
    get basis() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    check() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    sample() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    subscribe() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
    retire() {
      legacy.touched++;
      throw Error("LEGACY_OWNER_POISON");
    },
  }),
}));
function declaration() {
  const source = declaredInputs("INITIAL-ACK").original;
  return {
    source,
    workEndWallMs: (source.attachRequest.firstDispatchedAt + 4) * 1000,
    endWallMs: (source.attachRequest.firstDispatchedAt + 5) * 1000,
  };
}
function responses(options: ReturnType<typeof declaration>) {
  const b = options.source.originalBundle;
  const expected = options.source.attachRequest.preparation.expected;
  const rows: [string, unknown][] = [
    ["/v1/subscriptions/" + expected.subscriptionId, b.wireSubscription],
    ["/v1/prices/" + expected.targetPriceId, b.wireTargetPrice],
    ["/v1/customers/" + b.wireBillingCustomer.id, b.wireBillingCustomer],
  ];
  for (const row of b.couponReads) {
    assert(typeof row.couponId === "string");
    rows.push([
      "/v1/coupons/" + encodeURIComponent(row.couponId),
      row.wireCoupon,
    ]);
  }
  return new Map(rows);
}
beforeEach(() => {
  legacy.touched = 0;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(
    (declaration().source.attachRequest.firstDispatchedAt + 1) * 1000,
  );
  vi.spyOn(process.hrtime, "bigint").mockReturnValue(INITIAL_NS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("acquires complete raw Coupon material through its exact maintained SDK and bounded plan", async () => {
  const options = declaration();
  const bodies = responses(options);
  await initialOperations(
    async ({ fresh, journal, sdk }) => {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          assert.equal(url.origin, "https://api.stripe.com");
          assert.equal(init?.method, "GET");
          assert.equal(init?.redirect, "error");
          const headers = new Headers(init?.headers);
          assert.equal(
            headers.get("authorization"),
            "Bearer sk_test_invalid_owner_core",
          );
          assert.equal(headers.get("stripe-version"), sdk.stripeApiVersion);
          assert(bodies.has(url.pathname));
          calls.push(url.pathname);
          return new Response(JSON.stringify(bodies.get(url.pathname)), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "request-id": "req_initial_acquisition",
            },
          });
        },
      );
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof core.acquire).toBe("function");
        const result = await core.acquire();
        expect(result.ok).toBe(true);
        assert(result.ok);
        expect(result.bundle).toEqual(options.source.originalBundle);
        expect(result.observedAt).toBe(
          options.source.attachRequest.firstDispatchedAt + 1,
        );
        expect(result.sourceFulfillmentEstablished).toBe(false);
        expect(result.clockProvenanceEstablished).toBe(false);
        expect(result.operatorReady).toBe(false);
        expect(calls).toEqual([...bodies.keys()]);
        expect(
          (await core.material.fresh(result.bundle, result.observedAt)).status,
        ).toBe("classified");
        expect((await core.acquire()).ok).toBe(false);
        expect(calls).toEqual([...bodies.keys()]);
        expect(legacy.touched).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    options,
  );
});

it("refuses replacement acquisition inputs before clocks or HTTP", async () => {
  const options = declaration();
  await initialOperations(
    async ({ fresh, journal }) => {
      let foreign = 0,
        requests = 0;
      vi.stubGlobal("fetch", () => {
        requests++;
        throw Error("UNEXPECTED_HTTP");
      });
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof core.acquire).toBe("function");
        const input = {
          get expected() {
            foreign++;
            throw Error("FOREIGN_EXPECTED");
          },
        };
        const reads = vi.mocked(process.hrtime.bigint).mock.calls.length;
        await expect(
          Reflect.apply(core.acquire, undefined, [input]),
        ).rejects.toThrow("INITIAL_OPERATION_UNBOUND");
        expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(reads);
        expect(foreign).toBe(0);
        expect(requests).toBe(0);
        expect(legacy.touched).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    options,
  );
});

it("two pending acquisitions retain separate read lifetimes and cannot resume a retired Owner", async () => {
  const options = declaration();
  const bodies = responses(options);
  let first = () => {},
    both = () => {},
    retired = () => {},
    release = () => {};
  const firstRead = new Promise<void>((resolve) => {
    first = resolve;
  });
  const bothReads = new Promise<void>((resolve) => {
    both = resolve;
  });
  const firstRetired = new Promise<void>((resolve) => {
    retired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  await initialOperations(
    async ({ fresh, journal, index }) => {
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          assert.equal(url.origin, "https://api.stripe.com");
          assert.equal(init?.method, "GET");
          assert(bodies.has(url.pathname));
          calls.push(url.pathname);
          if (calls.length === 1) first();
          if (calls.length === 2) both();
          await gate;
          return new Response(JSON.stringify(bodies.get(url.pathname)), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "request-id": "req_pending_acquisition",
            },
          });
        },
      );
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof core.acquire).toBe("function");
        if (index === 1) await firstRead;
        const observed = core.acquire().then(
          (value) => ({ ok: true, value }),
          (error: unknown) => ({ ok: false, error }),
        );
        await bothReads;
        if (index === 0) {
          core.owner.retire();
          expect((await observed).ok).toBe(false);
          retired();
        } else {
          await firstRetired;
          release();
          const result = await observed;
          assert(result.ok && "value" in result && result.value.ok);
          expect(result.value.bundle).toEqual(options.source.originalBundle);
          expect(calls.length).toBe(bodies.size + 1);
          expect(core.owner.check().retired).toBe(false);
        }
        expect(legacy.touched).toBe(0);
      } finally {
        release();
        core.owner.retire();
      }
    },
    2,
    options,
  );
});
