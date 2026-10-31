import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import { declaredInputs } from "../test-fixtures/attachEntries.js";
import {
  captureRetainedInput,
  type RetainedInput,
} from "../material/capture.js";
import { INITIAL_NS } from "../test-fixtures/producerInitialDeclarations.js";
import {
  captureInitialInvocationCore,
  type InitialInvocationCore,
} from "./invocationProducer.js";
import { data } from "../test-fixtures/attachScenarioBarriers.js";
import { mintInitialLineage } from "./lineageAuthority.js";
import { captureInitialAttachForLineage } from "../operations/initialAttach.js";

const controls = vi.hoisted(() => {
  const entries: { coversRetained(): boolean; coversFresh(): boolean }[] = [];
  return { entries, legacy: 0 };
});
// Synthetic TEST coverage only. Production compiled profile arrays stay EMPTY.
vi.mock("../operations/sourceOperations.js", () => {
  const poisoned = () => {
    controls.legacy++;
    throw Error("LEGACY_SOURCE_POISON");
  };
  return {
    COMPILED_INITIAL_ENTRIES: controls.entries,
    ORIGINAL_ORIGIN_ASSOCIATION: null,
    loadFixedInitialOperation: poisoned,
    loadOwnedTransportSource: poisoned,
    loadInitialOwnedTransportSource: poisoned,
    loadRecoveryOwnedTransportSource: poisoned,
  };
});
vi.mock("../originalOwner.js", () => ({
  OWNER: Object.freeze({
    get basis() {
      controls.legacy++;
      throw Error("LEGACY_OWNER_POISON");
    },
    check() {
      controls.legacy++;
      throw Error("LEGACY_OWNER_POISON");
    },
    sample() {
      controls.legacy++;
      throw Error("LEGACY_OWNER_POISON");
    },
    subscribe() {
      controls.legacy++;
      throw Error("LEGACY_OWNER_POISON");
    },
    retire() {
      controls.legacy++;
      throw Error("LEGACY_OWNER_POISON");
    },
  }),
}));
type Input = Parameters<Parameters<typeof initialOperations>[0]>[0];
type Declaration = {
  source: RetainedInput;
  post: Record<string, unknown>;
  key: string;
};
function declaration(suffix?: string): Declaration {
  const original = declaredInputs("INITIAL-ACK");
  const replace = (_key: string, value: unknown) =>
    suffix && value === "sub_original" ? "sub_original_" + suffix : value;
  const raw = JSON.parse(JSON.stringify(original.original), replace);
  if (suffix) raw.attachRequest.attachKey += ":" + suffix;
  const post: Record<string, unknown> = JSON.parse(
    JSON.stringify(original.aPost),
    replace,
  );
  if (suffix) post.id += "_" + suffix;
  return {
    source: captureRetainedInput(raw),
    post,
    key: suffix
      ? "sk_test_invalid_actor_" + suffix
      : "sk_test_invalid_owner_core",
  };
}
function windowFor(source: RetainedInput) {
  return {
    workEndWallMs: (source.attachRequest.firstDispatchedAt + 4) * 1000,
    endWallMs: (source.attachRequest.firstDispatchedAt + 5) * 1000,
  };
}
function wireFor(
  declared: Declaration[],
  beforePost = async (_index: number) => {},
) {
  const calls: { method: string; path: string; index: number }[] = [];
  const routes = new Map<string, { body: unknown; auth: Set<string> }>();
  for (const item of declared) {
    const b = item.source.originalBundle;
    const rows: [string, unknown][] = [
      [
        "/v1/subscriptions/" +
          item.source.attachRequest.preparation.expected.subscriptionId,
        b.wireSubscription,
      ],
      [
        "/v1/prices/" +
          item.source.attachRequest.preparation.expected.targetPriceId,
        b.wireTargetPrice,
      ],
      ["/v1/customers/" + b.wireBillingCustomer.id, b.wireBillingCustomer],
    ];
    for (const row of b.couponReads) {
      assert(typeof row.couponId === "string");
      rows.push([
        "/v1/coupons/" + encodeURIComponent(row.couponId),
        row.wireCoupon,
      ]);
    }
    for (const [path, body] of rows) {
      const route = routes.get(path) ?? { body, auth: new Set<string>() };
      route.auth.add("Bearer " + item.key);
      routes.set(path, route);
    }
  }
  return {
    calls,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.stripe.com");
      assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization");
      let body: unknown,
        index = -1;
      if (init?.method === "GET") {
        const row = routes.get(url.pathname);
        assert(row && auth && row.auth.has(auth));
        body = row.body;
      } else {
        assert.equal(init?.method, "POST");
        assert.equal(url.pathname, "/v1/subscription_schedules");
        index = declared.findIndex(
          (item) =>
            item.source.attachRequest.attachKey ===
            headers.get("idempotency-key"),
        );
        assert(index >= 0);
        assert.equal(auth, "Bearer " + declared[index].key);
        assert.equal(
          new URLSearchParams(String(init?.body)).get("from_subscription"),
          declared[index].source.attachRequest.preparation.expected
            .subscriptionId,
        );
        await beforePost(index);
        body = declared[index].post;
      }
      calls.push({ method: init?.method ?? "", path: url.pathname, index });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_initial_actor_" + calls.length,
        },
      });
    },
  };
}
beforeEach(() => {
  controls.legacy = 0;
  controls.entries.splice(0, controls.entries.length, {
    coversRetained: () => true,
    coversFresh: () => true,
  });
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

it("runs the actual initial actor with original SDK, C10 commits and retained receipt before returning ACK DATA", async () => {
  const declared = declaration();
  await initialOperations(
    async (input) => {
      assert(input.fresh.result.disposition === "acquired");
      const reservation = input.fresh.result.reservation;
      const wire = wireFor([declared], async () => {
        expect(
          await input.journal.readStageEvent({
            attemptId: reservation.attemptId,
            sequence: 1,
          }),
        ).not.toBeNull();
        expect(await input.journal.readProviderAcknowledgement()).toBeNull();
      });
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(
        input.fresh.call,
        input.journal,
      );
      try {
        expect(typeof core.initialAttach).toBe("function");
        const actor = core.initialAttach();
        expect(core.initialAttach() === actor).toBe(true);
        const result = data(await actor.invoke());
        expect(result.status).toBe("attach_acknowledged");
        expect(result.operationalAuthority).toBe(false);
        expect(data(result.receipt).providerSnapshot).toEqual(declared.post);
        const retained = await input.journal.readProviderAcknowledgement();
        assert(retained);
        expect(JSON.parse(retained.receiptJSON)).toEqual(result.receipt);
        for (const sequence of [1, 2, 3] as const)
          expect(
            await input.journal.readStageEvent({
              attemptId: reservation.attemptId,
              sequence,
            }),
          ).not.toBeNull();
        const requests = wire.calls.length;
        expect(data(await actor.invoke()).reason).toBe("invocation_consumed");
        expect(wire.calls.length).toBe(requests);
        expect(wire.calls.filter((row) => row.method === "POST")).toHaveLength(
          1,
        );
        expect(controls.legacy).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});

it("EMPTY capture and invocation refuse before Source, client or clock effects", async () => {
  controls.entries.length = 0;
  const declared = declaration();
  await initialOperations(
    async ({ fresh, journal }) => {
      let http = 0;
      vi.stubGlobal("fetch", () => {
        http++;
        throw Error("UNEXPECTED_HTTP");
      });
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof core.initialAttach).toBe("function");
        const reads = vi.mocked(process.hrtime.bigint).mock.calls.length;
        expect(() =>
          Reflect.apply(core.initialAttach, undefined, [{}]),
        ).toThrow("INITIAL_OPERATION_UNBOUND");
        const actor = core.initialAttach();
        expect(data(await actor.invoke()).reason).toBe(
          "no_qualified_native_class",
        );
        expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(reads);
        expect(controls.legacy).toBe(0);
        expect(http).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});

it("a stale Owner cannot load an initial operation or write a stage event", async () => {
  const declared = declaration();
  await initialOperations(
    async (input) => {
      let http = 0;
      vi.stubGlobal("fetch", () => {
        http++;
        throw Error("UNEXPECTED_HTTP");
      });
      const core = await captureInitialInvocationCore(
        input.fresh.call,
        input.journal,
      );
      expect(typeof core.initialAttach).toBe("function");
      const actor = core.initialAttach();
      const before = await input.journal.loadAuthorizedOperation();
      core.owner.retire();
      await expect(actor.invoke()).rejects.toThrow("INITIAL_ACTOR_STOP");
      expect(await input.journal.loadAuthorizedOperation()).toEqual(before);
      expect(http).toBe(0);
      expect(controls.legacy).toBe(0);
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});

it("EMPTY factory admission does not construct an Owner for a fresh bare lineage", async () => {
  controls.entries.length = 0;
  const declared = declaration();
  await initialOperations(
    async ({ fresh, journal }) => {
      const token = mintInitialLineage(fresh.call, journal, 2);
      const reads = vi.mocked(process.hrtime.bigint).mock.calls.length;
      const actor = captureInitialAttachForLineage(token);
      expect(data(await actor.invoke()).reason).toBe(
        "no_qualified_native_class",
      );
      expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(reads);
      const stored = await journal.loadAuthorizedOperation();
      assert(stored && "initialBasis" in stored);
      expect(stored.initialBasis).toBeNull();
      expect(controls.legacy).toBe(0);
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});

it("two distinct SDK/root actors keep retained receipt DATA separate from returned ACK after one Owner retires", async () => {
  const declared = [declaration("alpha"), declaration("bravo")];
  const contexts: Input[] = [];
  const cores: InitialInvocationCore[] = [];
  let entered = () => {},
    retired = () => {},
    release = () => {},
    retainedCount = 0;
  const bothRetained = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const firstRetired = new Promise<void>((resolve) => {
    retired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wire = wireFor(declared);
  await initialOperations(
    async (input) => {
      contexts[input.index] = input;
      assert(input.fresh.result.disposition === "acquired");
      const reservation = input.fresh.result.reservation;
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(
        input.fresh.call,
        input.journal,
      );
      cores[input.index] = core;
      try {
        expect(typeof core.initialAttach).toBe("function");
        const observed = core
          .initialAttach()
          .invoke()
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        await bothRetained;
        const stored = await input.journal.readProviderAcknowledgement();
        assert(stored);
        expect(
          await input.journal.readStageEvent({
            attemptId: reservation.attemptId,
            sequence: 3,
          }),
        ).toBeNull();
        if (input.index === 0) {
          core.owner.retire();
          const result = await observed;
          if ("value" in result)
            expect(data(result.value).status).not.toBe("attach_acknowledged");
          retired();
        } else {
          await firstRetired;
          release();
          const result = await observed;
          assert("value" in result);
          expect(data(result.value).status).toBe("attach_acknowledged");
          expect(data(data(result.value).receipt).providerSnapshot).toEqual(
            declared[1].post,
          );
          expect(
            await input.journal.readStageEvent({
              attemptId: reservation.attemptId,
              sequence: 3,
            }),
          ).not.toBeNull();
          expect(core.owner.check().retired).toBe(false);
          expect(cores[0].owner === cores[1].owner).toBe(false);
          expect(contexts[0].sdk === contexts[1].sdk).toBe(false);
          expect(
            wire.calls.filter((row) => row.method === "POST"),
          ).toHaveLength(2);
        }
        release();
        expect(await input.journal.readProviderAcknowledgement()).toEqual(
          stored,
        );
        if (input.index === 0)
          expect(
            await input.journal.readStageEvent({
              attemptId: reservation.attemptId,
              sequence: 3,
            }),
          ).toBeNull();
        expect(controls.legacy).toBe(0);
      } finally {
        release();
        retired();
        core.owner.retire();
      }
    },
    2,
    {
      sources: declared.map((item) => item.source),
      keys: declared.map((item) => item.key),
      ...windowFor(declared[0].source),
      afterRetain: async () => {
        if (++retainedCount === 2) entered();
        await gate;
      },
    },
  );
});

it.each(["read", "post"] as const)(
  "actual SDK %s rejection stays bound to its invocation and cannot return ACK DATA",
  async (phase) => {
    const declared = declaration();
    const wire = wireFor([declared]);
    await initialOperations(
      async (input) => {
        assert(input.fresh.result.disposition === "acquired");
        const reservation = input.fresh.result.reservation;
        let failed = 0;
        vi.stubGlobal(
          "fetch",
          async (request: RequestInfo | URL, init?: RequestInit) => {
            if (phase === "read" || init?.method === "POST") {
              failed++;
              assert.equal(
                new URL(String(request)).origin,
                "https://api.stripe.com",
              );
              assert.equal(
                new Headers(init?.headers).get("authorization"),
                "Bearer " + declared.key,
              );
              if (phase === "post")
                expect(
                  await input.journal.readStageEvent({
                    attemptId: reservation.attemptId,
                    sequence: 1,
                  }),
                ).not.toBeNull();
              return new Response(
                JSON.stringify({
                  error: {
                    type: "invalid_request_error",
                    code: "synthetic_rejection",
                    message: "SYNTHETIC_PRIVATE_BODY_DO_NOT_FORWARD",
                  },
                }),
                {
                  status: 400,
                  headers: {
                    "content-type": "application/json",
                    "request-id": "req_initial_rejection",
                  },
                },
              );
            }
            return wire.fetch(request, init);
          },
        );
        const core = await captureInitialInvocationCore(
          input.fresh.call,
          input.journal,
        );
        try {
          const actor = core.initialAttach();
          const error: unknown = await actor.invoke().then(
            () => assert.fail("EXPECTED_PROVIDER_REJECTION"),
            (reason: unknown) => reason,
          );
          assert(error instanceof Error);
          expect(error.message).toBe("INITIAL_PROVIDER_REJECTED");
          const failure = data(
            Object.getOwnPropertyDescriptor(error, "failure")?.value,
          );
          expect(failure).toMatchObject({
            category: "provider_rejected",
            phase,
            ordinal:
              phase === "read"
                ? 1
                : declared.source.originalBundle.couponReads.length + 4,
            outcome: "unknown",
            operationalAuthority: false,
          });
          expect(JSON.stringify(failure)).not.toContain(
            "SYNTHETIC_PRIVATE_BODY_DO_NOT_FORWARD",
          );
          expect(failed).toBe(1);
          expect(await input.journal.readProviderAcknowledgement()).toBeNull();
          expect(
            await input.journal.readStageEvent({
              attemptId: reservation.attemptId,
              sequence: phase === "read" ? 1 : 2,
            }),
          ).toBeNull();
          expect(data(await actor.invoke()).reason).toBe("invocation_consumed");
          expect(failed).toBe(1);
          expect(controls.legacy).toBe(0);
        } finally {
          core.owner.retire();
        }
      },
      1,
      { source: declared.source, ...windowFor(declared.source) },
    );
  },
);
