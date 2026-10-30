import assert from "node:assert/strict";
import { vi } from "vitest";
import type { ObservationDeclaration } from "./observationDeclarations.js";
import type { ObservationState } from "./observationObservations.js";

export const MISSING_OBSERVATION_PORT =
  "BTS306_REPOSITORY_OBSERVATION_ORCHESTRATION_MISSING";
/** Exact TEST missing-feature frontier. Never a fabricated successful actor. */
export function captureMissingObservationPort(state: { targetCalls: number }) {
  assert.equal(arguments.length, 1);
  let consumed = false;
  return Object.freeze({
    async invoke() {
      assert.equal(arguments.length, 0);
      assert.equal(consumed, false);
      consumed = true;
      state.targetCalls++;
      throw Error(MISSING_OBSERVATION_PORT);
    },
  });
}
export const deferredLexicalProbe = Object.freeze({
  normalPort:
    "Await actual repository business Source; no copy body exists yet",
  additivePort: "Await exact actor; require full import-only/additive inverses",
  noExportedAuthority: true,
});

/** TEST diagnostics only. Does not inspect/unmask the normalized business error. */
export async function logObservationFailureFrontier(
  h: import("./observationOperation.js").ObservationFixture,
) {
  const descriptor = {
    present: false,
    data: false,
    getter: false,
    setter: false,
    enumerable: false,
    configurable: false,
    inspectionFailed: false,
  };
  try {
    // Same literal resolved module as the actor; inspect metadata without invoking getter.
    const namespace = await import("../material/classifiers.js");
    const own = Object.getOwnPropertyDescriptor(
      namespace,
      "classifyOwnedRetainedInitialAttachment",
    );
    descriptor.present = own !== undefined;
    if (own) {
      descriptor.data = Object.prototype.hasOwnProperty.call(own, "value");
      descriptor.getter = typeof own.get === "function";
      descriptor.setter = typeof own.set === "function";
      descriptor.enumerable = own.enumerable === true;
      descriptor.configurable = own.configurable === true;
    }
  } catch {
    // Diagnostics must not replace the original failed test with an import error.
    descriptor.inspectionFailed = true;
  }
  console.log(
    JSON.stringify({
      kind: "REPOSITORY_OBSERVATION_FAILURE_FRONTIER",
      targetCalls: h.state.targetCalls,
      sourceLoads: h.state.sourceLoads,
      C6Entries: h.state.ownedC6,
      C3Entries: h.state.ownedC3,
      C3Fulfilled: h.state.C3Fulfilled,
      C3Rejected: h.state.C3Rejected,
      recordVerificationEntered: h.state.recordVerificationEntered,
      recordVerificationCompleted: h.state.recordVerificationCompleted,
      observerEntries: h.state.ownedObserver,
      coverageEntries: h.state.coverage,
      C9Entries: h.state.ownedC9,
      readonlyHTTP: h.http.calls.length,
      delegateArgCalls: h.http.argsSeen.length,
      delegateEntriesAfterOwner: h.http.delegateEntriesAfterOwner(),
      originalReadPromises: h.http.originals.length,
      originalAPIPromises: h.state.originals.length,
      registeredAPISideObservers: h.state.pending.length,
      finalReadSampleRecorded: h.http.finalSample() !== null,
      preflightPairLoads: h.prerequisite.state.pairLoads,
      preflightReadonlyCalls: h.prerequisite.state.readonlyCalls,
      appendedRecords: h.prerequisite.deltas().records,
      POSTs: h.prerequisite.deltas().POST,
      classifierExportDescriptor: descriptor,
      operationalAuthority: false,
    }),
  );
}

/** Source fault recipes are selected before constructors; only this new TEST tuple changes. */
export function controlOperation<
  T extends {
    owner: unknown;
    originAssociation: unknown;
    originalEntry: unknown;
    observationEntry: unknown;
    actualAttachAcknowledgement: unknown;
    record: Pick<
      import("../preflight/grammar.js").PreflightRecord,
      "configuration" | "request"
    >;
    readTransport: unknown;
  },
>(op: T, d: ObservationDeclaration, s: ObservationState): unknown {
  const mode = d.controlCase;
  if (mode === "G02-owner") return Object.freeze({ ...op, owner: d.foreign });
  if (mode === "G02-origin")
    return Object.freeze({ ...op, originAssociation: d.foreign });
  if (mode === "G02-entry")
    return Object.freeze({ ...op, originalEntry: d.foreign });
  if (mode === "G02-observation-entry")
    return Object.freeze({ ...op, observationEntry: d.foreign });
  if (mode === "G02-ack-clone")
    return Object.freeze({
      ...op,
      actualAttachAcknowledgement: structuredClone(
        op.actualAttachAcknowledgement,
      ),
    });
  if (mode === "G02-tuple-proxy")
    return new Proxy(op, {
      get(target, key, receiver) {
        s.tupleTraps++;
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        s.tupleTraps++;
        return Reflect.ownKeys(target);
      },
      getPrototypeOf(target) {
        s.tupleTraps++;
        return Reflect.getPrototypeOf(target);
      },
      getOwnPropertyDescriptor(target, key) {
        s.tupleTraps++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  if (mode === "G02-method-getter") {
    const delegate = {};
    Object.defineProperty(delegate, "rawRequest", {
      enumerable: true,
      get() {
        s.methodGetterCalls++;
        throw Error("TEST_UNEXPECTED_UNTRUSTED_GETTER");
      },
    });
    return Object.freeze({ ...op, readTransport: Object.freeze(delegate) });
  }
  if (mode === "G02-optional-undefined")
    return Object.freeze({ ...op, configureAcknowledgement: undefined });
  if (mode === "G02-optional-null")
    return Object.freeze({ ...op, configureAcknowledgement: null });
  if (mode === "G02-optional-present")
    return Object.freeze({
      ...op,
      configureAcknowledgement: Object.freeze({
        declared: "UNBOUND_OPTIONAL_ACK",
      }),
    });
  if (mode === "G03-failure" || mode === "G03-retire") {
    const original = op.record.request.logicalBinding;
    const binding =
      original.slice(0, -1) + (original.endsWith("a") ? "b" : "a");
    return Object.freeze({
      ...op,
      record: Object.freeze({
        ...op.record,
        configuration: { ...op.record.configuration, apiVersion: d.invalidAPI },
        request: { ...op.record.request, logicalBinding: binding },
      }),
    });
  }
  if (mode === "G03-structural") {
    const configuration: Record<string, unknown> = {
      ...op.record.configuration,
    };
    delete configuration.preparation;
    return Object.freeze({ ...op, record: { ...op.record, configuration } });
  }
  return op;
}

/** EMPTY is tested without constructing any initial fixture or client. */
export async function assertEmptyObservation() {
  vi.resetModules();
  const effects = {
    source: 0,
    owner: 0,
    sample: 0,
    client: 0,
    record: 0,
    api: 0,
    read: 0,
  };
  const poison = (key: keyof typeof effects) => () => {
    effects[key]++;
    throw Error("EMPTY_EFFECT_" + key);
  };
  vi.doMock("../operations/sourceOperations.js", async () => {
    const actual = await vi.importActual<
      typeof import("../operations/sourceOperations.js")
    >("../operations/sourceOperations.js");
    return { ...actual, loadFixedObservationOperation: poison("source") };
  });
  vi.doMock("../originalOwner.js", () => ({
    OWNER: Object.freeze({
      check: poison("owner"),
      sample: poison("sample"),
      subscribe: poison("owner"),
      retire: poison("owner"),
      get basis() {
        return poison("owner")();
      },
    }),
  }));
  vi.doMock("../observation/record.js", async () => {
    const actual = await vi.importActual<
      typeof import("../observation/record.js")
    >("../observation/record.js");
    return { ...actual, captureObservationRecord: poison("record") };
  });
  vi.doMock("../../../renewalV2/index.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../../renewalV2/index.js")
    >("../../../renewalV2/index.js");
    return {
      ...actual,
      projectRenewalConfigurationV2: poison("api"),
      constructRenewalScheduleAttachmentReceiptV2: poison("api"),
      constructRenewalConfigurationReceiptV2: poison("api"),
    };
  });
  vi.doMock("../../../renewalV2/observation.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../../renewalV2/observation.js")
    >("../../../renewalV2/observation.js");
    return { ...actual, inspectRenewalScheduleMaterialV2: poison("api") };
  });
  vi.doMock("../../../../helpers.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../../../helpers.js")
    >("../../../../helpers.js");
    return { ...actual, getStripeClient: poison("client") };
  });
  vi.stubGlobal("fetch", poison("read"));
  try {
    const source = await import("../operations/sourceOperations.js");
    assert.deepEqual(source.COMPILED_OBSERVATION_ENTRIES, []);
    assert(Object.isFrozen(source.COMPILED_OBSERVATION_ENTRIES));
    const actor = await import("../observation/actor.js");
    const handle = actor.captureOwnedRenewalObservationV2();
    assert.deepEqual(await handle.invoke(), {
      status: "not_dispatched",
      reason: "OWNED_OBSERVATION_SOURCE_UNBOUND",
      operationalAuthority: false,
    });
    assert.deepEqual(effects, {
      source: 0,
      owner: 0,
      sample: 0,
      client: 0,
      record: 0,
      api: 0,
      read: 0,
    });
  } finally {
    for (const path of [
      "../operations/sourceOperations.js",
      "../originalOwner.js",
      "../observation/record.js",
      "../../../renewalV2/index.js",
      "../../../renewalV2/observation.js",
      "../../../../helpers.js",
    ])
      vi.doUnmock(path);
    vi.unstubAllGlobals();
    vi.resetModules();
  }
}

/** TEST-only finite latch; no clock or owner replacement. */
export function observationLatch() {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  return { entered: deferred(), release: deferred() };
}
export async function retireObservationHeld(
  h: import("./observationOperation.js").ObservationFixture,
  promise: ReturnType<ReturnType<typeof h.capture>["invoke"]>,
) {
  const observed = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    const frontier = await Promise.race([
      h.http.hold.entered.promise.then(() => "entered" as const),
      observed.then(() => "settled" as const),
    ]);
    assert.equal(
      frontier,
      "entered",
      "actual held HTTP frontier must precede settlement",
    );
    assert.equal(h.http.originals.length, h.declaration.transport.ordinal);
    h.OWNER.retire();
  } finally {
    h.http.hold.release.resolve();
  }
  return observed;
}
