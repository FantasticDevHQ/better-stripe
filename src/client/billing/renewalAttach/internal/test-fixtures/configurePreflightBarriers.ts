import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { data, type PreflightCase } from "./configurePreflightControls.js";

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function preflightBarriers(name: PreflightCase) {
  const entered = deferred(),
    released = deferred();
  const pending: Promise<unknown>[] = [];
  let held = false;
  return {
    pending,
    entered: entered.promise,
    release: released.resolve,
    async hold(kind: string) {
      if (held || name !== "hold-" + kind) return;
      held = true;
      entered.resolve();
      await released.promise;
    },
    async enterOrSettled(operation: Promise<unknown>) {
      const observed = operation.then(
        () => false,
        () => false,
      );
      assert.equal(
        await Promise.race([entered.promise.then(() => true), observed]),
        true,
        "TEST_PREREQUISITE_SETTLED_BEFORE_BARRIER",
      );
    },
    async cleanup() {
      released.resolve();
      await Promise.allSettled(pending);
    },
  };
}

export function installPreflightDigestBarrier(
  barriers: ReturnType<typeof preflightBarriers>,
  phase: () => string,
) {
  vi.stubGlobal("crypto", {
    subtle: {
      digest(
        algorithm: Parameters<typeof webcrypto.subtle.digest>[0],
        input: Parameters<typeof webcrypto.subtle.digest>[1],
      ) {
        const actual = webcrypto.subtle.digest(algorithm, input);
        const observed = actual.then(async (result) => {
          if (ArrayBuffer.isView(input)) {
            const tuple: unknown = JSON.parse(
              new TextDecoder().decode(
                new Uint8Array(
                  input.buffer,
                  input.byteOffset,
                  input.byteLength,
                ),
              ),
            );
            if (Array.isArray(tuple) && tuple[2] === "renewal-configure")
              await barriers.hold(phase());
          }
          return result;
        });
        barriers.pending.push(observed.catch(() => {}));
        return observed;
      },
    },
  });
}

export function cleanPreflightMocks() {
  for (const path of [
    "../sourceBindings.js",
    "../operations/sourceOperations.js",
    "../../../renewalV2/index.js",
    "../preflight/output.js",
    "../acquisition/readLifetime.js",
    "../acquisition/ownedAcquisition.js",
    "../operations/configureReadTransport.js",
    "../originalOwner.js",
    "../preflight/record.js",
  ])
    vi.doUnmock(path);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
}

export function preflightObservationState() {
  return {
    phase: "setup",
    c6: 0,
    c3: 0,
    releaseEntries: 0,
    coverage: 0,
    pairLoads: 0,
    operationLoads: 0,
    samples: 0,
    tupleTraps: 0,
    readonlyCalls: 0,
    methodRetargets: 0,
    initialFinished: false,
    pair: null as unknown,
    pairCreations: 0,
    readerBindings: 0,
    children: 0,
    finishes: 0,
    finishAt: null as number | null,
    scheduleReplies: 0,
    c6Results: [] as unknown[],
    records: [] as Record<string, unknown>[],
    calls: [] as { method: string; path: string }[],
  };
}

export type PreflightObservationState = ReturnType<
  typeof preflightObservationState
>;

export async function installPreflightObservers(
  state: PreflightObservationState,
  OWNER: typeof import("../originalOwner.js").OWNER,
  name: PreflightCase,
  gates: ReturnType<typeof preflightBarriers>,
  advanceLater: () => void,
  retargetReadMethod: () => void,
) {
  const actual = await vi.importActual<
    typeof import("../../../renewalV2/index.js")
  >("../../../renewalV2/index.js");
  vi.doMock("../../../renewalV2/index.js", () => ({
    ...actual,
    projectRenewalConfigurationV2(
      ...args: Parameters<typeof actual.projectRenewalConfigurationV2>
    ) {
      if (state.initialFinished) {
        state.phase = state.c6++ === 0 ? "original" : "fresh";
        if (state.phase === "fresh" && name === "later-sample") advanceLater();
      }
      const promise = actual.projectRenewalConfigurationV2(...args);
      gates.pending.push(
        promise.then(
          (value) => {
            state.c6Results.push(value);
            if (state.phase === "original" && name === "method-retarget")
              retargetReadMethod();
          },
          () => {},
        ),
      );
      return promise;
    },
    constructRenewalScheduleAttachmentReceiptV2(
      ...args: Parameters<
        typeof actual.constructRenewalScheduleAttachmentReceiptV2
      >
    ) {
      if (state.initialFinished) state.c3++;
      return actual.constructRenewalScheduleAttachmentReceiptV2(...args);
    },
  }));
  vi.doMock("../preflight/output.js", async () => {
    const real = await vi.importActual<typeof import("../preflight/output.js")>(
      "../preflight/output.js",
    );
    return {
      ...real,
      releasePreflight(...args: Parameters<typeof real.releasePreflight>) {
        state.releaseEntries++;
        return real.releasePreflight(...args);
      },
    };
  });
  vi.doMock("../operations/configureReadTransport.js", async () => {
    const real = await vi.importActual<
      typeof import("../operations/configureReadTransport.js")
    >("../operations/configureReadTransport.js");
    return {
      ...real,
      createConfigureOwnedReadTransport(
        ...args: Parameters<typeof real.createConfigureOwnedReadTransport>
      ) {
        const pair = real.createConfigureOwnedReadTransport(...args);
        state.pair = pair;
        state.pairCreations++;
        return pair;
      },
    };
  });
  vi.doMock("../acquisition/ownedAcquisition.js", async () => {
    const real = await vi.importActual<
      typeof import("../acquisition/ownedAcquisition.js")
    >("../acquisition/ownedAcquisition.js");
    return {
      ...real,
      bindConfigureReadAcquisitionFromSource(
        ...args: Parameters<typeof real.bindConfigureReadAcquisitionFromSource>
      ) {
        state.readerBindings++;
        assert.equal(args[0], OWNER);
        assert.equal(args[1], data(data(state.pair).transport).readTransport);
        return real.bindConfigureReadAcquisitionFromSource(...args);
      },
    };
  });
  vi.doMock("../acquisition/readLifetime.js", async () => {
    const real = await vi.importActual<
      typeof import("../acquisition/readLifetime.js")
    >("../acquisition/readLifetime.js");
    return {
      ...real,
      createReadLifetime(...args: Parameters<typeof real.createReadLifetime>) {
        const child = real.createReadLifetime(...args);
        if (!state.initialFinished) return child;
        assert.equal(args[0], OWNER);
        state.children++;
        return Object.freeze({
          begin: (...xs: Parameters<typeof child.begin>) =>
            Reflect.apply(child.begin, child, xs) as ReturnType<
              typeof child.begin
            >,
          check: (...xs: Parameters<typeof child.check>) =>
            Reflect.apply(child.check, child, xs) as ReturnType<
              typeof child.check
            >,
          fail: (...xs: Parameters<typeof child.fail>) =>
            Reflect.apply(child.fail, child, xs) as ReturnType<
              typeof child.fail
            >,
          finish(...xs: Parameters<typeof child.finish>) {
            const value = Reflect.apply(child.finish, child, xs) as ReturnType<
              typeof child.finish
            >;
            assert.equal(state.scheduleReplies, 1);
            state.finishes++;
            state.finishAt = value.wallMs;
            return value;
          },
        });
      },
    };
  });
  return actual;
}

/** EMPTY-only counter aliases; this fake Owner supplies no canonical/custody proof. */
export function installEmptyPreflightSpies() {
  const counts = {
    Source: 0,
    Owner: 0,
    check: 0,
    sample: 0,
    client: 0,
    capture: 0,
    api: 0,
    read: 0,
  };
  const effect = (key: keyof typeof counts): never => {
    counts[key]++;
    throw Error("EMPTY_EFFECT_" + key);
  };
  const owner = Object.freeze({
    check: () => effect("check"),
    sample: () => effect("sample"),
  });
  const counterOwner = new Proxy(owner, {
    get(target, key, receiver) {
      counts.Owner++;
      return Reflect.get(target, key, receiver);
    },
  });
  vi.doMock("../originalOwner.js", () => ({ OWNER: counterOwner }));
  vi.doMock("../sourceBindings.js", () => ({
    loadOwnedOriginalSource: () => effect("Source"),
    loadFixedStockClient: () => effect("client"),
  }));
  vi.doMock("../operations/sourceOperations.js", async () => {
    const real = await vi.importActual<
      typeof import("../operations/sourceOperations.js")
    >("../operations/sourceOperations.js");
    assert.deepEqual(real.COMPILED_PREFLIGHT_ENTRIES, []);
    return {
      ...real,
      loadOwnedConfigureOperation: () => effect("Source"),
      loadConfigureOwnedReadTransportSource: () => effect("Source"),
    };
  });
  vi.doMock("../../../renewalV2/index.js", async () => {
    const real = await vi.importActual<
      typeof import("../../../renewalV2/index.js")
    >("../../../renewalV2/index.js");
    return {
      ...real,
      projectRenewalConfigurationV2: () => effect("api"),
      constructRenewalScheduleAttachmentReceiptV2: () => effect("api"),
    };
  });
  vi.doMock("../preflight/record.js", async () => {
    const real = await vi.importActual<typeof import("../preflight/record.js")>(
      "../preflight/record.js",
    );
    return { ...real, capturePreflightRecord: () => effect("capture") };
  });
  vi.doMock("../operations/configureReadTransport.js", async () => {
    const real = await vi.importActual<
      typeof import("../operations/configureReadTransport.js")
    >("../operations/configureReadTransport.js");
    return { ...real, createConfigureOwnedReadTransport: () => effect("read") };
  });
  vi.doMock("../acquisition/ownedAcquisition.js", async () => {
    const real = await vi.importActual<
      typeof import("../acquisition/ownedAcquisition.js")
    >("../acquisition/ownedAcquisition.js");
    return {
      ...real,
      bindConfigureReadAcquisitionFromSource: () => effect("read"),
    };
  });
  return counts;
}
