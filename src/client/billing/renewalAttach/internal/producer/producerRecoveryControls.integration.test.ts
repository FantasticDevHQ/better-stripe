import assert from "node:assert/strict";
import { canonicalJournalEvent } from "../../../../../shared/renewalOperationJournal.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import { declaredInputs } from "../test-fixtures/attachEntries.js";
import {
  captureRetainedInput,
  type RetainedInput,
} from "../material/capture.js";
import { INITIAL_NS } from "../test-fixtures/producerInitialDeclarations.js";
import { captureInitialInvocationCore } from "./invocationProducer.js";
import { data } from "../test-fixtures/attachScenarioBarriers.js";

const controls = vi.hoisted(() => {
  const entries: { coversRetained(): boolean; coversFresh(): boolean }[] = [];
  const recovery: { originalEntry: unknown; coversReplay(): boolean }[] = [];
  return { entries, recovery, legacy: 0 };
});
// Synthetic TEST coverage only. Production compiled profile arrays stay EMPTY.
vi.mock("../operations/sourceOperations.js", () => {
  const poisoned = () => {
    controls.legacy++;
    throw Error("LEGACY_SOURCE_POISON");
  };
  return {
    COMPILED_INITIAL_ENTRIES: controls.entries,
    COMPILED_RECOVERY_ENTRIES: controls.recovery,
    loadFixedExplicitRecoveryOperation: poisoned,
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
  controls.recovery.splice(0, controls.recovery.length, {
    originalEntry: controls.entries[0],
    coversReplay: () => true,
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

function recover(core: object) {
  const capture = Reflect.get(core, "recoverAttach");
  expect(typeof capture).toBe("function");
  return Reflect.apply(capture, core, []) as { invoke(): Promise<unknown> };
}

it.each(["before_attempt", "returned_ack", "retired"])(
  "refuses recovery for %s without additional provider work",
  async (state) => {
    const declared = declaration();
    await initialOperations(
      async ({ fresh, journal }) => {
        const wire = wireFor([declared]);
        vi.stubGlobal("fetch", wire.fetch);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        try {
          if (state === "returned_ack")
            expect(data(await core.initialAttach().invoke()).status).toBe(
              "attach_acknowledged",
            );
          if (state === "retired") core.owner.retire();
          const calls = wire.calls.length;
          await expect(recover(core).invoke()).rejects.toThrow();
          expect(wire.calls).toHaveLength(calls);
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

it("EMPTY recovery and replacement arguments refuse before new clock or provider effects", async () => {
  const declared = declaration();
  controls.recovery.length = 0;
  await initialOperations(
    async ({ fresh, journal }) => {
      const wire = wireFor([declared]);
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        const wall = vi.spyOn(Date, "now");
        const mono = vi.mocked(process.hrtime.bigint).mock.calls.length;
        let foreign = 0;
        const replacement = {
          get client() {
            foreign++;
            throw Error("FOREIGN");
          },
        };
        expect(() =>
          Reflect.apply(core.recoverAttach, undefined, [replacement]),
        ).toThrow("INITIAL_OPERATION_UNBOUND");
        const actor = recover(core);
        expect(data(await actor.invoke()).reason).toBe(
          "no_qualified_recovery_class",
        );
        await expect(
          Reflect.apply(actor.invoke, undefined, [replacement]),
        ).rejects.toThrow("INITIAL_ACTOR_STOP");
        expect(wall).not.toHaveBeenCalled();
        expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(mono);
        expect(foreign).toBe(0);
        expect(wire.calls).toHaveLength(0);
        expect(controls.legacy).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});

it("refuses recovery while a committed response2 mutation reply remains pending", async () => {
  const declared = declaration();
  let count = 0,
    release!: () => void,
    entered!: () => void;
  const reply = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await initialOperations(
    async ({ fresh, journal }) => {
      assert(fresh.result.disposition === "acquired");
      const wire = wireFor([declared]);
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        const initial = core.initialAttach().invoke();
        await committed;
        await vi.advanceTimersByTimeAsync(5000);
        expect(data(await initial).status).toBe("fulfilled_unverified");
        const requests = wire.calls.length;
        await expect(recover(core).invoke()).rejects.toThrow(
          "INITIAL_ACTOR_STOP",
        );
        expect(wire.calls).toHaveLength(requests);
        expect(wire.calls.filter((row) => row.method === "POST")).toHaveLength(
          1,
        );
        expect(
          await journal.readStageEvent({
            attemptId: fresh.result.reservation.attemptId,
            sequence: 2,
          }),
        ).not.toBeNull();
        expect(
          await journal.readStageEvent({
            attemptId: fresh.result.reservation.attemptId,
            sequence: 3,
          }),
        ).toBeNull();
        expect(await journal.readProviderAcknowledgement()).toBeNull();
        expect(controls.legacy).toBe(0);
      } finally {
        release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        core.owner.retire();
      }
    },
    1,
    {
      source: declared.source,
      workEndWallMs:
        (declared.source.attachRequest.firstDispatchedAt + 20) * 1000,
      endWallMs: (declared.source.attachRequest.firstDispatchedAt + 21) * 1000,
      afterAppend: async () => {
        count++;
        if (count === 2) {
          entered();
          await reply;
        }
      },
    },
  );
});

it.each(["relation", "retained_predicate", "fresh_predicate"])(
  "refuses changed %s before replay reads or POST",
  async (change) => {
    const declared = declaration();
    await initialOperations(
      async ({ fresh, journal }) => {
        let posts = 0;
        const wire = wireFor([declared], async () => {
          posts++;
          throw Error("CONTROLLED_LOST_RESPONSE");
        });
        vi.stubGlobal("fetch", wire.fetch);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        try {
          await expect(core.initialAttach().invoke()).rejects.toThrow(
            "INITIAL_PROVIDER_REJECTED",
          );
          if (change === "relation") controls.recovery[0].originalEntry = {};
          if (change === "retained_predicate")
            controls.entries[0].coversRetained = () => true;
          if (change === "fresh_predicate")
            controls.entries[0].coversFresh = () => true;
          const requests = wire.calls.length;
          await expect(recover(core).invoke()).rejects.toThrow(
            "INITIAL_ACTOR_STOP",
          );
          expect(wire.calls).toHaveLength(requests);
          expect(posts).toBe(1);
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

it("refuses another POST when actual journal history advances during a blocked recovery read", async () => {
  const declared = declaration();
  await initialOperations(
    async ({ fresh, journal }) => {
      assert(fresh.result.disposition === "acquired");
      let posts = 0,
        release!: () => void,
        entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const readEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wire = wireFor([declared], async () => {
        posts++;
        if (posts === 1) throw Error("CONTROLLED_LOST_RESPONSE");
      });
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (
            posts === 1 &&
            init?.method === "GET" &&
            new URL(String(input)).pathname.startsWith("/v1/subscriptions/")
          ) {
            entered();
            await blocked;
          }
          return wire.fetch(input, init);
        },
      );
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        await expect(core.initialAttach().invoke()).rejects.toThrow(
          "INITIAL_PROVIDER_REJECTED",
        );
        const recovery = recover(core)
          .invoke()
          .catch((error) => error);
        await readEntered;
        // Concurrent host-authorized journal DATA is not provider response custody.
        const event = await canonicalJournalEvent(
          2,
          JSON.stringify({ frontier: "advanced-during-recovery-read" }),
        );
        await journal.appendStageEvent({
          reservation: fresh.result.reservation,
          expectedSequence: 1,
          event: { sequence: 2, binding: event.binding, dataJSON: event.json },
        });
        release();
        const result = await recovery;
        expect(posts).toBe(1);
        expect(result).toMatchObject({ message: "INITIAL_ACTOR_STOP" });
        expect(await journal.readProviderAcknowledgement()).toBeNull();
        expect(controls.legacy).toBe(0);
      } finally {
        release();
        core.owner.retire();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});
