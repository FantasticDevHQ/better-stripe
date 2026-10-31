import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialOperations } from "../test-fixtures/producerInitialOperation.js";
import { declaredInputs } from "../test-fixtures/attachEntries.js";
import { INITIAL_NS } from "../test-fixtures/producerInitialDeclarations.js";
import {
  captureInitialInvocationCore,
  type InitialInvocationCore,
} from "./invocationProducer.js";
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "../../../renewalV2/index.js";
import { createInitialMaterialClassifiers } from "../material/classifiers.js";

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
beforeEach(() => {
  legacy.touched = 0;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(
    (declaredInputs("INITIAL-ACK").original.attachRequest.firstDispatchedAt +
      1) *
      1000,
  );
  vi.spyOn(process.hrtime, "bigint").mockReturnValue(INITIAL_NS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("classifies original retained and fresh Coupon material with its actual invocation Owner", async () => {
  const source = declaredInputs("INITIAL-ACK").original;
  const prepared = await prepareRenewalPriceReplacementV2(
    source.attachRequest.preparation,
  );
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: source.attachRequest.apiVersion,
    attachKey: source.attachRequest.attachKey,
    firstDispatchedAt: source.attachRequest.firstDispatchedAt,
  });
  await initialOperations(
    async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(core.material).toBeDefined();
        const retained = await core.material.retained();
        expect(retained.status).toBe("classified");
        assert(retained.status === "classified");
        expect(retained.kind).toBe("RENEWAL_MATERIAL_V2_DATA_CONSISTENCY_ONLY");
        expect(retained.material.originalPrepared).toEqual(prepared);
        expect(retained.material.completeRequest).toEqual(request);
        expect(retained.material.rawSources.attachRequest).toEqual(
          source.attachRequest,
        );
        const current = structuredClone(source.originalBundle);
        const live = await core.material.fresh(
          current,
          source.attachRequest.firstDispatchedAt,
        );
        expect(live.status).toBe("classified");
        assert(live.status === "classified");
        expect(live.material.freshness).toBe("fresh");
        expect(live.material.completeRequest).toEqual(request);
        expect(Object.isFrozen(live.material)).toBe(true);
        expect(legacy.touched).toBe(0);
        expect(core.operationalAuthority).toBe(false);
      } finally {
        core.owner.retire();
      }
    },
    1,
    {
      source,
      workEndWallMs: (source.attachRequest.firstDispatchedAt + 4) * 1000,
      endWallMs: (source.attachRequest.firstDispatchedAt + 5) * 1000,
    },
  );
});

it("refuses replacement retained source and incompatible fresh material without legacy access", async () => {
  const source = declaredInputs("INITIAL-ACK").original;
  await initialOperations(
    async ({ fresh, journal }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      try {
        expect(core.material).toBeDefined();
        let read = 0;
        const foreign = {
          get attachRequest() {
            read++;
            throw Error("FOREIGN_SOURCE");
          },
        };
        expect(() =>
          Reflect.apply(core.material.retained, undefined, [foreign]),
        ).toThrow("INITIAL_MATERIAL_UNBOUND");
        expect(read).toBe(0);
        const current = structuredClone(source.originalBundle);
        current.wireSubscription.schedule = "sub_sched_foreign";
        expect(
          (
            await core.material.fresh(
              current,
              source.attachRequest.firstDispatchedAt,
            )
          ).status,
        ).toBe("unsupported");
        expect((await core.material.retained()).status).toBe("classified");
        core.owner.retire();
        expect(() => core.material.retained()).toThrow("INITIAL_OWNER_STOP");
        expect(legacy.touched).toBe(0);
      } finally {
        core.owner.retire();
      }
    },
    1,
    {
      source,
      workEndWallMs: (source.attachRequest.firstDispatchedAt + 4) * 1000,
      endWallMs: (source.attachRequest.firstDispatchedAt + 5) * 1000,
    },
  );
});

it("retiring one Owner rejects its pending material reconstruction while another finishes", async () => {
  const source = declaredInputs("INITIAL-ACK").original;
  const cores: InitialInvocationCore[] = [];
  let ready = () => {},
    entered = () => {},
    retired = () => {},
    release = () => {};
  const bothReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const bothPending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const firstRetired = new Promise<void>((resolve) => {
    retired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = false,
    pending = 0;
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(
    async (algorithm, data) => {
      const value = await nativeDigest(algorithm, data);
      if (holding) {
        if (++pending === 2) entered();
        await gate;
      }
      return value;
    },
  );
  await initialOperations(
    async ({ fresh, journal, index }) => {
      const core = await captureInitialInvocationCore(fresh.call, journal);
      cores[index] = core;
      try {
        expect(core.material).toBeDefined();
        if (cores.filter(Boolean).length === 2) ready();
        await bothReady;
        holding = true;
        const observed = core.material.retained().then(
          (value) => ({ ok: true, value }),
          (error: unknown) => ({ ok: false, error }),
        );
        await bothPending;
        if (index === 0) {
          core.owner.retire();
          expect((await observed).ok).toBe(false);
          retired();
        } else {
          await firstRetired;
          release();
          const result = await observed;
          expect(result.ok).toBe(true);
          assert("value" in result);
          expect(result.value.status).toBe("classified");
          expect(core.owner.check().retired).toBe(false);
        }
        expect(legacy.touched).toBe(0);
      } finally {
        release();
        core.owner.retire();
      }
    },
    2,
    {
      source,
      workEndWallMs: (source.attachRequest.firstDispatchedAt + 4) * 1000,
      endWallMs: (source.attachRequest.firstDispatchedAt + 5) * 1000,
    },
  );
});

it("opaque stored material remains unsupported rather than gaining source qualification", async () => {
  // The original codec fixture has an opaque bundle instead of raw Coupon joins.
  vi.setSystemTime(1700000002000);
  await initialOperations(async ({ fresh, journal }) => {
    const core = await captureInitialInvocationCore(fresh.call, journal);
    try {
      expect((await core.material.retained()).status).toBe("unsupported");
      expect((await core.material.fresh({}, 1700000002)).status).toBe(
        "unsupported",
      );
      expect(core.operationalAuthority).toBe(false);
      expect(legacy.touched).toBe(0);
    } finally {
      core.owner.retire();
    }
  });
});

it("forged lineage cannot select a classifier Owner or sample clocks", () => {
  const now = vi.spyOn(Date, "now");
  expect(() => createInitialMaterialClassifiers(Object.freeze({}))).toThrow(
    "INITIAL_LINEAGE_UNBOUND",
  );
  expect(now).not.toHaveBeenCalled();
  expect(legacy.touched).toBe(0);
});
