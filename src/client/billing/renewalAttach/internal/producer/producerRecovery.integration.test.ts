import assert from "node:assert/strict";
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

it.each([null, "sub_sched_observed_unknown"])(
  "explicitly recovers an unknown initial POST with association %s and the original key, Owner and journal",
  async (observed) => {
    const declared = declaration();
    await initialOperations(
      async ({ fresh, journal }) => {
        assert(fresh.result.disposition === "acquired");
        let posts = 0;
        const wire = wireFor([declared], async () => {
          posts++;
          if (posts === 1) throw Error("CONTROLLED_LOST_POST_RESPONSE");
        });
        vi.stubGlobal(
          "fetch",
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const response = await wire.fetch(input, init);
            if (
              posts > 0 &&
              init?.method === "GET" &&
              new URL(String(input)).pathname.startsWith("/v1/subscriptions/")
            ) {
              const body = await response.json();
              body.schedule = observed;
              return new Response(JSON.stringify(body), {
                status: response.status,
                headers: response.headers,
              });
            }
            return response;
          },
        );
        const core = await captureInitialInvocationCore(fresh.call, journal);
        const basis = core.basisJSON;
        try {
          await expect(core.initialAttach().invoke()).rejects.toThrow(
            "INITIAL_PROVIDER_REJECTED",
          );
          expect(posts).toBe(1);
          expect(await journal.readProviderAcknowledgement()).toBeNull();
          expect(
            await journal.readStageEvent({
              attemptId: fresh.result.reservation.attemptId,
              sequence: 2,
            }),
          ).toBeNull();
          const actor = recover(core);
          expect(recover(core)).toBe(actor);
          const result = data(await actor.invoke());
          assert.equal(
            result.status,
            "attach_acknowledged",
            JSON.stringify(result),
          );
          expect(result.operationalAuthority).toBe(false);
          expect(posts).toBe(2);
          expect(core.basisJSON).toBe(basis);
          const retained = await journal.readProviderAcknowledgement();
          assert(retained);
          expect(JSON.parse(retained.receiptJSON)).toEqual(result.receipt);
          for (const sequence of [1, 2, 3] as const)
            expect(
              await journal.readStageEvent({
                attemptId: fresh.result.reservation.attemptId,
                sequence,
              }),
            ).not.toBeNull();
          expect(data(await actor.invoke()).reason).toBe("invocation_consumed");
          expect(posts).toBe(2);
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

it.each([2, 3])(
  "resumes acknowledgement from actual safe response custody after a late committed event %s reply without another POST",
  async (delayedSequence) => {
    const declared = declaration();
    let appended = 0;
    let release!: () => void;
    const pendingReply = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const responseCommitted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await initialOperations(
      async ({ fresh, journal }) => {
        assert(fresh.result.disposition === "acquired");
        const wire = wireFor([declared]);
        vi.stubGlobal("fetch", wire.fetch);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        const basis = core.basisJSON;
        try {
          const initial = core.initialAttach().invoke();
          await responseCommitted;
          await vi.advanceTimersByTimeAsync(5000);
          expect(data(await initial).status).toBe("fulfilled_unverified");
          if (delayedSequence === 2)
            expect(await journal.readProviderAcknowledgement()).toBeNull();
          else
            expect(await journal.readProviderAcknowledgement()).not.toBeNull();
          release();
          await new Promise<void>((resolve) => setImmediate(resolve));
          const result = data(await recover(core).invoke());
          assert.equal(
            result.status,
            "attach_acknowledged",
            JSON.stringify(result),
          );
          expect(core.basisJSON).toBe(basis);
          expect(
            wire.calls.filter((row) => row.method === "POST"),
          ).toHaveLength(1);
          const retained = await journal.readProviderAcknowledgement();
          assert(retained);
          expect(JSON.parse(retained.receiptJSON)).toEqual(result.receipt);
          expect(
            await journal.readStageEvent({
              attemptId: fresh.result.reservation.attemptId,
              sequence: 3,
            }),
          ).not.toBeNull();
          expect(controls.legacy).toBe(0);
        } finally {
          release();
          core.owner.retire();
        }
      },
      1,
      {
        source: declared.source,
        workEndWallMs:
          (declared.source.attachRequest.firstDispatchedAt + 20) * 1000,
        endWallMs:
          (declared.source.attachRequest.firstDispatchedAt + 21) * 1000,
        afterAppend: async () => {
          appended++;
          if (appended === delayedSequence) {
            entered();
            await pendingReply;
          }
        },
      },
    );
  },
);

it.each([
  { sequence: 2, point: "before" },
  { sequence: 2, point: "after" },
  { sequence: 3, point: "before" },
  { sequence: 3, point: "after" },
])(
  "resumes ACK after $point-commit event$sequence RPC rejection using a separate channel sender",
  async ({ sequence, point }) => {
    const declared = declaration();
    let calls = 0;
    const failSelected = async () => {
      calls++;
      if (calls === sequence) throw Error("CONTROLLED_APPEND_RPC_REJECTION");
    };
    await initialOperations(
      async ({ fresh, journal }) => {
        const wire = wireFor([declared]);
        vi.stubGlobal("fetch", wire.fetch);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        try {
          expect(data(await core.initialAttach().invoke()).status).toBe(
            "fulfilled_unverified",
          );
          const result = data(await recover(core).invoke());
          expect(result.status).toBe("attach_acknowledged");
          expect(
            wire.calls.filter((row) => row.method === "POST"),
          ).toHaveLength(1);
          const retained = await journal.readProviderAcknowledgement();
          assert(retained);
          expect(JSON.parse(retained.receiptJSON)).toEqual(result.receipt);
          expect(controls.legacy).toBe(0);
        } finally {
          core.owner.retire();
        }
      },
      1,
      {
        source: declared.source,
        ...windowFor(declared.source),
        ...(point === "before"
          ? { beforeAppend: failSelected }
          : { afterAppend: failSelected }),
      },
    );
  },
);
