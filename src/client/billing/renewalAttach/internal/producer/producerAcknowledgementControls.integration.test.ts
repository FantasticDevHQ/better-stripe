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

function acknowledgement(core: object) {
  const read = Reflect.get(core, "attachAcknowledgement");
  expect(typeof read).toBe("function");
  return Reflect.apply(read, core, []) as Readonly<{
    output: unknown;
    receipt: unknown;
    operationalAuthority: false;
  }>;
}

it.each(["retained", "fresh", "registry"])(
  "a cached ACK refuses changed %s eligibility instead of returning stale custody",
  async (change) => {
    const declared = declaration();
    await initialOperations(
      async ({ fresh, journal }) => {
        const wire = wireFor([declared]);
        vi.stubGlobal("fetch", wire.fetch);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        try {
          const output = await core.initialAttach().invoke();
          expect(acknowledgement(core).output).toBe(output);
          if (change === "retained")
            controls.entries[0].coversRetained = () => true;
          if (change === "fresh") controls.entries[0].coversFresh = () => true;
          if (change === "registry") controls.entries.length = 0;
          const requests = wire.calls.length;
          expect(() => acknowledgement(core)).toThrow(
            "ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE",
          );
          expect(wire.calls).toHaveLength(requests);
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

it("copied receipt DATA, unknown tokens and extra arguments cannot register custody or sample clocks", async () => {
  const declared = declaration();
  const { readAttachAcknowledgementForLineage: read } =
    await import("./attachAcknowledgement.js");
  await initialOperations(
    async ({ fresh, journal }) => {
      const wire = wireFor([declared]);
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        const output = await core.initialAttach().invoke();
        const view = acknowledgement(core);
        const copy = JSON.parse(JSON.stringify(output));
        let foreign = 0;
        const fake = {
          get receipt() {
            foreign++;
            throw Error("FOREIGN_RECEIPT");
          },
        };
        const wall = vi.spyOn(Date, "now");
        const mono = vi.mocked(process.hrtime.bigint).mock.calls.length;
        expect(() => read(copy.receipt)).toThrow("INITIAL_LINEAGE_UNBOUND");
        expect(() => read(fake)).toThrow("INITIAL_LINEAGE_UNBOUND");
        expect(() =>
          Reflect.apply(read, undefined, [fake, copy.receipt]),
        ).toThrow("ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE");
        expect(() =>
          Reflect.apply(core.attachAcknowledgement, undefined, [fake]),
        ).toThrow("INITIAL_OPERATION_UNBOUND");
        expect(foreign).toBe(0);
        expect(wall).not.toHaveBeenCalled();
        expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(mono);
        expect(view.receipt).not.toBe(copy.receipt);
        expect(acknowledgement(core)).toBe(view);
        expect(controls.legacy).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});

it("a committed receipt3 event with a pending reply is DATA until the real actor returns", async () => {
  const declared = declaration();
  let count = 0,
    entered!: () => void,
    release!: () => void;
  const committed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
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
        expect(await journal.readProviderAcknowledgement()).not.toBeNull();
        expect(
          await journal.readStageEvent({
            attemptId: fresh.result.reservation.attemptId,
            sequence: 3,
          }),
        ).not.toBeNull();
        expect(() => acknowledgement(core)).toThrow(
          "ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE",
        );
        release();
        const output = await initial;
        expect(acknowledgement(core).output).toBe(output);
        expect(acknowledgement(core).receipt).toBe(data(output).receipt);
        expect(controls.legacy).toBe(0);
      } finally {
        release();
        core.owner.retire();
      }
    },
    1,
    {
      source: declared.source,
      ...windowFor(declared.source),
      afterAppend: async () => {
        count++;
        if (count === 3) {
          entered();
          await pending;
        }
      },
    },
  );
});

it("two real SDK roots retain distinct ACK identities and retirement invalidates only the original cached view", async () => {
  const declared = [declaration("alpha"), declaration("bravo")];
  const wire = wireFor(declared);
  const cores: Awaited<ReturnType<typeof captureInitialInvocationCore>>[] = [];
  const outputs: unknown[] = [];
  let ready = 0,
    allReady!: () => void,
    retired!: () => void;
  const complete = new Promise<void>((resolve) => {
    allReady = resolve;
  });
  const retirement = new Promise<void>((resolve) => {
    retired = resolve;
  });
  await initialOperations(
    async ({ fresh, journal, index }) => {
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(fresh.call, journal);
      cores[index] = core;
      try {
        outputs[index] = await core.initialAttach().invoke();
        const view = acknowledgement(core);
        ready++;
        if (ready === 2) allReady();
        await complete;
        expect(view.output).toBe(outputs[index]);
        expect(view.receipt).toBe(data(outputs[index]).receipt);
        expect(view.receipt).not.toBe(data(outputs[1 - index]).receipt);
        if (index === 0) {
          await retirement;
          expect(() => acknowledgement(core)).toThrow("INITIAL_OWNER_STOP");
        } else {
          cores[0].owner.retire();
          retired();
          expect(acknowledgement(core)).toBe(view);
          expect(data(view.receipt).providerSnapshot).toEqual(declared[1].post);
        }
        expect(controls.legacy).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    2,
    {
      sources: declared.map((value) => value.source),
      keys: declared.map((value) => value.key),
      ...windowFor(declared[0].source),
    },
  );
  expect(wire.calls.filter((row) => row.method === "POST")).toHaveLength(2);
});

it("reading absent ACK custody from a genuine bare lineage cannot construct an Owner or sample clocks", async () => {
  const declared = declaration();
  const { mintInitialLineage } = await import("./lineageAuthority.js");
  const { readAttachAcknowledgementForLineage: read } =
    await import("./attachAcknowledgement.js");
  await initialOperations(
    async ({ fresh, journal }) => {
      const token = mintInitialLineage(fresh.call, journal, 2);
      const mono = vi.mocked(process.hrtime.bigint).mock.calls.length;
      const wall = vi.spyOn(Date, "now");
      const timers = vi.spyOn(globalThis, "setTimeout");
      try {
        expect(() => read(token)).toThrow("ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE");
        expect(wall).not.toHaveBeenCalled();
        expect(vi.mocked(process.hrtime.bigint).mock.calls.length).toBe(mono);
        expect(timers).not.toHaveBeenCalled();
        const stored = await journal.loadAuthorizedOperation();
        assert(
          stored && "recordVersion" in stored && stored.recordVersion === 2,
        );
        expect(stored.initialBasis).toBeNull();
        expect(controls.legacy).toBe(0);
      } finally {
        vi.clearAllTimers();
      }
    },
    1,
    { source: declared.source, ...windowFor(declared.source) },
  );
});
