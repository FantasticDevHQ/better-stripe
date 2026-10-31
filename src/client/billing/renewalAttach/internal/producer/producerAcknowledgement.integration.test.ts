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

function acknowledgement(core: object) {
  const read = Reflect.get(core, "attachAcknowledgement");
  expect(typeof read).toBe("function");
  return Reflect.apply(read, core, []) as Readonly<{
    output: unknown;
    receipt: unknown;
    operationalAuthority: false;
  }>;
}

it.each(["initial", "replay", "resume"])(
  "retains the exact actual %s output and receipt identities without replacement inputs",
  async (path) => {
    const declared = declaration();
    let appended = 0;
    await initialOperations(
      async ({ fresh, journal }) => {
        let posts = 0;
        const wire = wireFor([declared], async () => {
          posts++;
          if (path === "replay" && posts === 1)
            throw Error("CONTROLLED_LOST_RESPONSE");
        });
        vi.stubGlobal("fetch", wire.fetch);
        const core = await captureInitialInvocationCore(fresh.call, journal);
        try {
          let output: unknown;
          if (path === "initial") output = await core.initialAttach().invoke();
          else {
            if (path === "replay")
              await expect(core.initialAttach().invoke()).rejects.toThrow(
                "INITIAL_PROVIDER_REJECTED",
              );
            else
              expect(data(await core.initialAttach().invoke()).status).toBe(
                "fulfilled_unverified",
              );
            output = await recover(core).invoke();
          }
          expect(data(output).status).toBe("attach_acknowledged");
          const view = acknowledgement(core);
          expect(view.output).toBe(output);
          expect(view.receipt).toBe(data(output).receipt);
          expect(view.operationalAuthority).toBe(false);
          expect(acknowledgement(core)).toBe(view);
          const copy = JSON.parse(JSON.stringify(output));
          expect(copy).toEqual(output);
          expect(copy.receipt).not.toBe(view.receipt);
          const calls = wire.calls.length;
          expect(() =>
            Reflect.apply(core.attachAcknowledgement, undefined, [
              copy.receipt,
            ]),
          ).toThrow("INITIAL_OPERATION_UNBOUND");
          expect(wire.calls).toHaveLength(calls);
          expect(posts).toBe(path === "replay" ? 2 : 1);
          expect(controls.legacy).toBe(0);
        } finally {
          core.owner.retire();
        }
      },
      1,
      {
        source: declared.source,
        ...windowFor(declared.source),
        afterAppend: async () => {
          appended++;
          if (path === "resume" && appended === 2)
            throw Error("CONTROLLED_APPEND_REPLY_REJECTION");
        },
      },
    );
  },
);

it("committed receipt DATA does not become returned ACK custody while retention reply is pending, and absence is not cached", async () => {
  const declared = declaration();
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await initialOperations(
    async ({ fresh, journal }) => {
      const wire = wireFor([declared]);
      vi.stubGlobal("fetch", wire.fetch);
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(typeof Reflect.get(core, "attachAcknowledgement")).toBe(
          "function",
        );
        expect(() => acknowledgement(core)).toThrow(
          "ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE",
        );
        const initial = core.initialAttach().invoke();
        await committed;
        expect(await journal.readProviderAcknowledgement()).not.toBeNull();
        expect(() => acknowledgement(core)).toThrow(
          "ATTACH_ACKNOWLEDGEMENT_UNAVAILABLE",
        );
        release();
        const output = await initial;
        const view = acknowledgement(core);
        expect(view.output).toBe(output);
        expect(view.receipt).toBe(data(output).receipt);
        expect(wire.calls.filter((row) => row.method === "POST")).toHaveLength(
          1,
        );
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
      afterRetain: async () => {
        entered();
        await pending;
      },
    },
  );
});
