import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import { declaredInputs } from "../test-fixtures/attachEntries.js";
import { INITIAL_NS } from "../test-fixtures/producerInitialDeclarations.js";
import {
  captureInitialInvocationCore,
  type InitialInvocationCore,
} from "./invocationProducer.js";
import { mintInitialLineage, readInitialLineage } from "./lineageAuthority.js";
import { ownerForInitialLineage } from "./ownerFactory.js";
import { ownedAwaitForInitialLineage } from "./ownedAwaitFactory.js";
import { captureInitialStockRawDelegate } from "./stockDelegateFactory.js";
import { operationForInitialLineage } from "./operationFactory.js";
import { getStripeClient } from "../../../../helpers.js";

async function liveToken(
  input: Parameters<Parameters<typeof initialOperations>[0]>[0],
) {
  const token = mintInitialLineage(input.fresh.call, input.journal, 2);
  const lineage = readInitialLineage(token);
  const owner = ownerForInitialLineage(token);
  const reservation = lineage.reservation;
  assert("timingPolicyJSON" in reservation);
  const owned = ownedAwaitForInitialLineage(token);
  await owned(() =>
    input.journal.bindInitialBasis({
      attemptId: reservation.attemptId,
      policyJSON: reservation.timingPolicyJSON,
      basisJSON: lineage.basisJSON,
    }),
  );
  owner.check();
  return { token, lineage, owner, owned };
}

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
const query = String(
  new URLSearchParams(
    ["discounts", "items.data.discounts", "items.data.price"].map(
      (value, index) => ["expand[" + index + "]", value],
    ),
  ),
);
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

it("constructs one canonical bounded transport from its actual original journal invocation", async () => {
  const options = declaration();
  await initialOperations(
    async ({ fresh, journal, sdk }) => {
      const calls: {
        method: string | undefined;
        path: string;
        version: string | null;
        auth: string | null;
        redirect: RequestRedirect | undefined;
      }[] = [];
      const path =
        "/v1/subscriptions/" +
        options.source.attachRequest.preparation.expected.subscriptionId +
        "?" +
        query;
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          const headers = new Headers(init?.headers);
          calls.push({
            method: init?.method,
            path: url.pathname + url.search,
            version: headers.get("stripe-version"),
            auth: headers.get("authorization"),
            redirect: init?.redirect,
          });
          assert.equal(url.origin, "https://api.stripe.com");
          assert.equal(url.pathname + url.search, path);
          assert.equal(init?.method, "GET");
          return new Response(
            JSON.stringify(options.source.originalBundle.wireSubscription),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "request-id": "req_initial_transport",
              },
            },
          );
        },
      );
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof core.transport).toBe("function");
        const pair = await core.transport();
        expect((await core.transport()) === pair).toBe(true);
        expect((await pair.transport.postAttach()).outcome).toBe("not_started");
        expect(calls).toHaveLength(0);
        const reply = await core.owned(() =>
          pair.transport.readTransport.rawRequest("GET", path, undefined, {
            apiVersion: sdk.stripeApiVersion,
            maxNetworkRetries: 0,
          }),
        );
        expect(reply).toMatchObject({
          id: options.source.attachRequest.preparation.expected.subscriptionId,
        });
        expect(calls).toEqual([
          {
            method: "GET",
            path,
            version: sdk.stripeApiVersion,
            auth: "Bearer sk_test_invalid_owner_core",
            redirect: "error",
          },
        ]);
        expect((await pair.transport.postAttach()).outcome).toBe("not_started");
        expect(legacy.touched).toBe(0);
        expect(core.operationalAuthority).toBe(false);
      } finally {
        core.owner.retire();
      }
    },
    1,
    options,
  );
});

it("refuses replacement construction arguments and an out-of-plan read before HTTP", async () => {
  const options = declaration();
  await initialOperations(
    async ({ fresh, journal }) => {
      let requests = 0,
        foreign = 0;
      vi.stubGlobal("fetch", () => {
        requests++;
        throw Error("UNEXPECTED_HTTP");
      });
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof core.transport).toBe("function");
        const replacement = {
          get client() {
            foreign++;
            throw Error("FOREIGN_CLIENT");
          },
        };
        const now = vi.spyOn(Date, "now");
        const clockReads = vi.mocked(process.hrtime.bigint).mock.calls.length;
        await expect(
          Reflect.apply(core.transport, undefined, [replacement]),
        ).rejects.toThrow("INITIAL_OPERATION_UNBOUND");
        expect(now).not.toHaveBeenCalled();
        expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(
          clockReads,
        );
        expect(foreign).toBe(0);
        const pair = await core.transport();
        await expect(
          pair.transport.readTransport.rawRequest(
            "GET",
            "/v1/prices/price_target",
            undefined,
            { apiVersion: "2026-09-30.endive", maxNetworkRetries: 0 },
          ),
        ).rejects.toThrow();
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

it("the fixed stock delegate retains the actual maintained SDK promise and original receiver", async () => {
  const options = declaration();
  await initialOperations(
    async (input) => {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        async (_request: RequestInfo | URL, init?: RequestInit) => {
          calls.push(new Headers(init?.headers).get("authorization") ?? "");
          return new Response(
            JSON.stringify({ id: "sub_original", object: "subscription" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      );
      const h = await liveToken(input);
      try {
        const descriptor = Object.getOwnPropertyDescriptor(
          h.lineage.client,
          "_requestSender",
        );
        assert(
          descriptor &&
            descriptor.value &&
            typeof descriptor.value === "object",
        );
        const sender = descriptor.value;
        const original = sender._rawRequest;
        assert(typeof original === "function");
        const promises: unknown[] = [];
        vi.spyOn(sender, "_rawRequest").mockImplementation(
          (...args: unknown[]) => {
            const promise = Reflect.apply(original, sender, args);
            promises.push(promise);
            return promise;
          },
        );
        const foreign = getStripeClient(
          "sk_test_invalid_foreign_native_promise",
          input.sdk.stripeApiVersion,
          { singleAttempt: true },
        );
        const delegate = captureInitialStockRawDelegate(h.token);
        const actual = delegate.rawRequest.call(
          foreign,
          "GET",
          "/v1/subscriptions/sub_original",
          undefined,
          { apiVersion: input.sdk.stripeApiVersion, maxNetworkRetries: 0 },
        );
        expect(promises.length).toBe(1);
        expect(actual === promises[0]).toBe(true);
        expect(await h.owned(() => actual)).toMatchObject({
          id: "sub_original",
        });
        expect(calls).toEqual(["Bearer sk_test_invalid_owner_core"]);
        expect(legacy.touched).toBe(0);
      } finally {
        h.owner.retire();
      }
    },
    1,
    options,
  );
});

it("canonical original slots refuse a foreign Owner before clocks and cannot be revived", async () => {
  const options = declaration();
  const entries: Awaited<ReturnType<typeof liveToken>>[] = [];
  let constructed = 0;
  let ready = () => {},
    first = () => {};
  const bothReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const firstDone = new Promise<void>((resolve) => {
    first = resolve;
  });
  await initialOperations(
    async (input) => {
      const h = await liveToken(input);
      entries[input.index] = h;
      try {
        const frame = await operationForInitialLineage(h.token);
        expect((await operationForInitialLineage(h.token)) === frame).toBe(
          true,
        );
        expect(
          frame.operation.originAssociation === h.lineage.originAssociation,
        ).toBe(true);
        if (++constructed === 2) ready();
        await bothReady;
        if (input.index === 0) {
          const reads = vi.mocked(process.hrtime.bigint).mock.calls.length;
          expect(frame.operation.slot.takeOnce(entries[1].owner)).toBeNull();
          expect(frame.operation.slot.takeOnce(h.owner)).toBeNull();
          expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(
            reads,
          );
          first();
        } else {
          await firstDone;
          const selected = frame.operation.slot.takeOnce(h.owner);
          assert(selected);
          expect(selected.rawAttachRequest).toEqual(
            options.source.attachRequest,
          );
          expect(selected.originalBundle).toEqual(
            options.source.originalBundle,
          );
          expect(frame.operation.slot.takeOnce(h.owner)).toBeNull();
        }
        expect(legacy.touched).toBe(0);
      } finally {
        first();
        h.owner.retire();
      }
    },
    2,
    options,
  );
});

it("stock capture rejects extra client arguments before lineage or clock access", () => {
  const reads = vi.mocked(process.hrtime.bigint).mock.calls.length;
  expect(() =>
    Reflect.apply(captureInitialStockRawDelegate, undefined, [{}, {}]),
  ).toThrow("INITIAL_OPERATION_UNBOUND");
  expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(reads);
  expect(legacy.touched).toBe(0);
});

it("two pending actual SDK reads retain independent Owners and transport attempt state", async () => {
  const options = declaration();
  const cores: InitialInvocationCore[] = [];
  let ready = () => {},
    first = () => {},
    both = () => {},
    retired = () => {},
    release = () => {};
  const readyGate = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const firstRead = new Promise<void>((resolve) => {
    first = resolve;
  });
  const bothReads = new Promise<void>((resolve) => {
    both = resolve;
  });
  const firstRetired = new Promise<void>((resolve) => {
    retired = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await initialOperations(
    async ({ fresh, journal, index, sdk }) => {
      vi.stubGlobal("fetch", async () => {
        if (++requests === 1) first();
        if (requests === 2) both();
        await responseGate;
        return new Response(
          JSON.stringify(options.source.originalBundle.wireSubscription),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "request-id": "req_two_initial_transports",
            },
          },
        );
      });
      const core = await captureInitialInvocationCore(fresh.call, journal);
      cores[index] = core;
      try {
        expect(typeof core.transport).toBe("function");
        const pair = await core.transport();
        if (cores.filter(Boolean).length === 2) ready();
        await readyGate;
        if (index === 1) await firstRead;
        const path =
          "/v1/subscriptions/" +
          options.source.attachRequest.preparation.expected.subscriptionId +
          "?" +
          query;
        const observed = core
          .owned(() =>
            pair.transport.readTransport.rawRequest("GET", path, undefined, {
              apiVersion: sdk.stripeApiVersion,
              maxNetworkRetries: 0,
            }),
          )
          .then(
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
          expect(result.ok).toBe(true);
          expect(core.owner.check().retired).toBe(false);
        }
        expect(requests).toBe(2);
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
