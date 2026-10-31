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

it("retiring one recovery during a pending SDK read cannot retire another SDK root or return its receipt", async () => {
  const declared = [declaration("alpha"), declaration("bravo")];
  const posts = [0, 0];
  let ready = 0,
    allReady!: () => void,
    readEntered!: () => void,
    release!: () => void;
  const readyBarrier = new Promise<void>((resolve) => {
    allReady = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    readEntered = resolve;
  });
  const pendingRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cores: ({ owner: { retire(): void } } | undefined)[] = [];
  const wire = wireFor(declared, async (index) => {
    posts[index]++;
    if (posts[index] === 1) throw Error("CONTROLLED_LOST_RESPONSE");
  });
  const controlledFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const path = new URL(String(input)).pathname;
    if (
      posts[0] === 1 &&
      init?.method === "GET" &&
      path ===
        "/v1/subscriptions/" +
          declared[0].source.attachRequest.preparation.expected.subscriptionId
    ) {
      readEntered();
      await pendingRead;
    }
    return wire.fetch(input, init);
  };
  try {
    await initialOperations(
      async ({ fresh, journal, index }) => {
        vi.stubGlobal("fetch", controlledFetch);
        assert(fresh.result.disposition === "acquired");
        const core = await captureInitialInvocationCore(fresh.call, journal);
        cores[index] = core;
        try {
          await expect(core.initialAttach().invoke()).rejects.toThrow(
            "INITIAL_PROVIDER_REJECTED",
          );
          expect(posts[index]).toBe(1);
          ready++;
          if (ready === 2) allReady();
          await readyBarrier;
          if (index === 0) {
            const result = recover(core).invoke();
            const observed = result.catch((error) => error);
            await entered;
            expect(await observed).toMatchObject({
              message: "INITIAL_ACTOR_STOP",
            });
            expect(await journal.readProviderAcknowledgement()).toBeNull();
            expect(
              await journal.readStageEvent({
                attemptId: fresh.result.reservation.attemptId,
                sequence: 2,
              }),
            ).toBeNull();
          } else {
            await entered;
            cores[0]!.owner.retire();
            const result = data(await recover(core).invoke());
            expect(result.status).toBe("attach_acknowledged");
            expect(data(result.receipt).providerSnapshot).toEqual(
              declared[1].post,
            );
            const retained = await journal.readProviderAcknowledgement();
            assert(retained);
            expect(JSON.parse(retained.receiptJSON)).toEqual(result.receipt);
            expect(
              await journal.readStageEvent({
                attemptId: fresh.result.reservation.attemptId,
                sequence: 3,
              }),
            ).not.toBeNull();
          }
          expect(controls.legacy).toBe(0);
        } finally {
          core.owner.retire();
          if (index === 0) release();
        }
      },
      2,
      {
        sources: declared.map((item) => item.source),
        keys: declared.map((item) => item.key),
        ...windowFor(declared[0].source),
      },
    );
    expect(posts).toEqual([1, 2]);
  } finally {
    release();
    for (const core of cores) core?.owner.retire();
  }
});

it("an explicit recovery cannot renew the original absolute deadline after an unknown POST", async () => {
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
      const basis = core.basisJSON;
      try {
        await expect(core.initialAttach().invoke()).rejects.toThrow(
          "INITIAL_PROVIDER_REJECTED",
        );
        const requests = wire.calls.length;
        vi.setSystemTime(windowFor(declared.source).workEndWallMs);
        await expect(recover(core).invoke()).rejects.toThrow(
          "INITIAL_OWNER_STOP",
        );
        expect(core.basisJSON).toBe(basis);
        expect(wire.calls).toHaveLength(requests);
        expect(posts).toBe(1);
        expect(await journal.readProviderAcknowledgement()).toBeNull();
        expect(controls.legacy).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});
