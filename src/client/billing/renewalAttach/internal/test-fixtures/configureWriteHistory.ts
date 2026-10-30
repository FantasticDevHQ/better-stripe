import { AsyncLocalStorage } from "node:async_hooks";
import { vi } from "vitest";
import { createWriteHTTPAndSink } from "./configureWriteAssertions.js";
import {
  declareConfigureWriteCase,
  declareConfigureWriteFamily,
} from "./configureWriteDeclarations.js";
import { writeObservationState } from "./configureWriteObservations.js";
import type { configureWriteBarriers } from "./configureWriteBarriers.js";
import type { ProjectedRenewalConfigurationV2 } from "../../../renewalV2/index.js";
import assert from "node:assert/strict";
import type { WriteCase } from "./configureWriteDeclarations.js";
import type { WriteObservations } from "./configureWriteObservations.js";

/** TEST declaration of expected later replay facts, not a registry granting authority. */
export function declareExpectedReplay(originalRequest: unknown) {
  return Object.freeze({
    originalRequest,
    persistentCustody: false,
    requiresActualUnknownPOST: true,
    requiresOriginalOwner: true,
    permitsJSONRehydration: false,
    permitsAutomaticRetry: false,
  });
}

/** TEST-only closed Source construction; no production module imports this fixture. */
export function declareWriteSources(args: {
  mode: WriteCase;
  owner: object;
  origin: object;
  entry: object;
  coverage: object;
  record: object;
  configuration: object;
  preflightOutput: unknown;
  acknowledgement: unknown;
  plan: readonly unknown[];
  delegate: object;
  sink: object;
  request: unknown;
  state: WriteObservations;
}) {
  const {
    mode,
    owner: OWNER,
    origin,
    entry,
    coverage,
    record: expectedRecord,
    configuration: goodConfiguration,
    preflightOutput,
    acknowledgement,
    plan: configurePlan,
    delegate: writeDelegate,
    sink: writeSink,
    request: projected,
    state: writeState,
  } = args;
  let reserved = false;
  const writerRecord =
    mode === "original-failure"
      ? {
          ...expectedRecord,
          configuration: {
            ...goodConfiguration,
            apiVersion: "unsupported-configure-write-api",
          },
        }
      : mode === "structural-failure"
        ? {
            ...expectedRecord,
            configuration: { ...goodConfiguration, unexpected: true },
          }
        : mode === "forged-preflight"
          ? preflightOutput
          : expectedRecord;
  const writerFields = {
    owner: mode === "foreign-owner" ? Object.freeze({}) : OWNER,
    originAssociation: mode === "foreign-origin" ? Object.freeze({}) : origin,
    originalEntry: mode === "foreign-entry" ? Object.freeze({}) : entry,
    configureEntry:
      mode === "foreign-class" ? Object.freeze({ ...coverage }) : coverage,
    originalRecord: writerRecord,
    actualAttachAcknowledgement:
      mode === "cloned-ack"
        ? structuredClone(acknowledgement)
        : acknowledgement,
    readPlan:
      mode === "foreign-plan"
        ? Object.freeze([...configurePlan])
        : configurePlan,
    delegate: writeDelegate,
    sink: writeSink,
    reserve() {
      assert.equal(reserved, false);
      reserved = true;
      writeState.reserves++;
      return true;
    },
  };
  const writerOperation = Object.freeze(writerFields);
  const writerFrame = Object.freeze({
    owner: OWNER,
    operation:
      mode === "foreign-operation" ? Object.freeze({}) : writerOperation,
    request: projected,
    readPlan: configurePlan,
    delegate:
      mode === "foreign-delegate"
        ? Object.freeze({
            rawRequest() {
              throw Error("FOREIGN_WRITE_DELEGATE_CALLED");
            },
          })
        : writeDelegate,
  });
  return { operation: writerOperation, frame: writerFrame };
}

/** Immutable TEST-only replay operation; the actor must find actual private history itself. */
export function declareReplaySources(args: {
  owner: object;
  origin: object;
  entry: object;
  coverage: object;
  previous: object;
  plan: readonly unknown[];
  delegate: object;
  sink: object;
  request: unknown;
  state: WriteObservations;
}) {
  let reserved = false;
  const operation = Object.freeze({
    owner: args.owner,
    originAssociation: args.origin,
    originalEntry: args.entry,
    configureEntry: args.coverage,
    previousOperation: args.previous,
    readPlan: args.plan,
    delegate: args.delegate,
    sink: args.sink,
    reserve() {
      assert.equal(reserved, false);
      reserved = true;
      args.state.reserves++;
      return true;
    },
  });
  return Object.freeze({
    operation,
    frame: Object.freeze({
      owner: args.owner,
      operation,
      request: args.request,
      readPlan: args.plan,
      delegate: args.delegate,
    }),
  });
}

/** Finite closed TEST producer. The asynchronous binding never escapes to the SUT or caller. */
export async function configureWriteTestFamily(args: {
  declared: ReturnType<typeof declareConfigureWriteCase>;
  declarations: ReturnType<typeof declareConfigureWriteFamily>;
  owner: typeof import("../originalOwner.js").OWNER;
  origin: object;
  entry: object;
  coverage: object;
  record: object;
  configuration: object;
  preflightOutput: unknown;
  acknowledgement: unknown;
  plan: readonly unknown[];
  delegate: { rawRequest(...args: unknown[]): Promise<unknown> };
  request: ProjectedRenewalConfigurationV2;
  firstState: WriteObservations;
  gates: ReturnType<typeof configureWriteBarriers>;
  advance: (next: number) => void;
}) {
  const states = {
    A: args.firstState,
    B: writeObservationState(),
    C: writeObservationState(),
  };
  const declarations = args.declarations.stages;
  const times = {
    A: args.declared.writeAt,
    B: args.declared.replay.BAt,
    C: args.declared.replay.CAt,
  };
  const routes = {
    A: createWriteHTTPAndSink(
      declarations.A,
      states.A,
      args.gates,
      args.request,
      args.owner,
      () => args.advance(times.A),
    ),
    B: createWriteHTTPAndSink(
      declarations.B,
      states.B,
      args.gates,
      args.request,
      args.owner,
      () => args.advance(times.B),
    ),
    C: createWriteHTTPAndSink(
      declarations.C,
      states.C,
      args.gates,
      args.request,
      args.owner,
      () => args.advance(times.C),
    ),
  };
  const delegates = {
    A:
      args.declared.name === "source-post-sync-throw" ||
      args.declared.name === "source-post-nonpromise" ||
      args.declared.name === "source-post-hostile-late-reject"
        ? Object.freeze({
            rawRequest(...values: unknown[]) {
              if (values[0] === "POST" && values[1] === args.request.path) {
                states.A.trace.push(args.declared.name);
                if (args.declared.name === "source-post-hostile-late-reject") {
                  const trap = (): never => {
                    states.A.traps++;
                    throw Error("TEST_LATE_SOURCE_REFLECTION");
                  };
                  const hostile = new Proxy(Object.freeze({}), {
                    get: trap,
                    ownKeys: trap,
                    getPrototypeOf: trap,
                    getOwnPropertyDescriptor: trap,
                  });
                  const promise = args.gates
                    .hold("source-rejection")
                    .then(() => {
                      throw hostile;
                    });
                  args.gates.pending.push(
                    promise.then(
                      () => {},
                      () => {},
                    ),
                  );
                  return promise;
                }
                if (args.declared.name === "source-post-sync-throw")
                  throw Error("TEST_SOURCE_DELEGATE_SYNCHRONOUS_FAILURE");
                return Object.freeze({ notAnSDKPromise: true });
              }
              return Reflect.apply(
                args.delegate.rawRequest,
                args.delegate,
                values,
              ) as ReturnType<typeof args.delegate.rawRequest>;
            },
          })
        : args.delegate,
    B: Object.freeze({
      rawRequest(...xs: unknown[]) {
        return Reflect.apply(
          args.delegate.rawRequest,
          args.delegate,
          xs,
        ) as Promise<unknown>;
      },
    }),
    C: Object.freeze({
      rawRequest(...xs: unknown[]) {
        return Reflect.apply(
          args.delegate.rawRequest,
          args.delegate,
          xs,
        ) as Promise<unknown>;
      },
    }),
  };
  const A = declareWriteSources({
    mode: args.declared.name,
    owner: args.owner,
    origin: args.origin,
    entry: args.entry,
    coverage: args.coverage,
    record: args.record,
    configuration: args.configuration,
    preflightOutput: args.preflightOutput,
    acknowledgement: args.acknowledgement,
    plan: args.plan,
    delegate: delegates.A,
    sink: routes.A.sink,
    request: args.request,
    state: states.A,
  });
  const previousB =
    args.declared.name === "foreign-prior"
      ? Object.freeze({})
      : args.declared.name === "cloned-prior"
        ? Object.freeze({ ...A.operation })
        : A.operation;
  const B = declareReplaySources({
    owner: args.owner,
    origin: args.origin,
    entry: args.entry,
    coverage: args.coverage,
    previous: previousB,
    plan: args.plan,
    delegate: delegates.B,
    sink: routes.B.sink,
    request: args.request,
    state: states.B,
  });
  const C = declareReplaySources({
    owner: args.owner,
    origin: args.origin,
    entry: args.entry,
    coverage: args.coverage,
    previous:
      args.declared.replay.previousC === "A" ? A.operation : B.operation,
    plan: args.plan,
    delegate: delegates.C,
    sink: routes.C.sink,
    request: args.request,
    state: states.C,
  });
  for (const state of Object.values(states)) state.phase = "writer";
  const bindings = Object.freeze({
    A: Object.freeze({
      ...A,
      state: states.A,
      route: routes.A,
      time: times.A,
      stage: "A",
    }),
    B: Object.freeze({
      ...B,
      state: states.B,
      route: routes.B,
      time: times.B,
      stage: "B",
    }),
    C: Object.freeze({
      ...C,
      state: states.C,
      route: routes.C,
      time: times.C,
      stage: "C",
    }),
  });
  type Binding = (typeof bindings)[keyof typeof bindings];
  const scope = new AsyncLocalStorage<Binding>();
  const bound = () => {
    const value = scope.getStore();
    assert(value, "MISSING_TEST_ASYNC_BINDING");
    return value;
  };
  vi.stubGlobal("fetch", (input: unknown, init: RequestInit) =>
    bound().route.fetch(input, init),
  );
  // Lazy import follows actual initial ACK/preflight and TEST Source mock installation.
  const actualActor = await import("../configure/actor.js");
  function observedHandle(
    binding: Binding,
    handle: ReturnType<typeof actualActor.captureOwnedConfigureV2>,
  ) {
    return Object.freeze({
      invoke(...values: unknown[]) {
        binding.state.targetCalls++;
        const promise = scope.run(binding, () =>
          Reflect.apply(handle.invoke, handle, values),
        ) as ReturnType<typeof handle.invoke>;
        args.gates.pending.push(
          promise.then(
            () => {},
            () => {},
          ),
        );
        return promise;
      },
    });
  }
  function captureA(...values: unknown[]) {
    const handle = scope.run(bindings.A, () =>
      Reflect.apply(actualActor.captureOwnedConfigureV2, actualActor, values),
    ) as ReturnType<typeof actualActor.captureOwnedConfigureV2>;
    return observedHandle(bindings.A, handle);
  }
  function captureB(...values: unknown[]) {
    const handle = scope.run(bindings.B, () =>
      Reflect.apply(
        actualActor.captureOwnedConfigureReplayV2,
        actualActor,
        values,
      ),
    ) as ReturnType<typeof actualActor.captureOwnedConfigureReplayV2>;
    return observedHandle(bindings.B, handle);
  }
  function captureC(...values: unknown[]) {
    const handle = scope.run(bindings.C, () =>
      Reflect.apply(
        actualActor.captureOwnedConfigureReplayV2,
        actualActor,
        values,
      ),
    ) as ReturnType<typeof actualActor.captureOwnedConfigureReplayV2>;
    return observedHandle(bindings.C, handle);
  }
  return Object.freeze({
    captureA,
    captureB,
    captureC,
    fixedAOperation() {
      return A.operation;
    },
    readFixedA(...values: unknown[]) {
      return scope.run(bindings.A, () =>
        Reflect.apply(delegates.A.rawRequest, delegates.A, values),
      ) as Promise<unknown>;
    },
    states,
    currentObservations: () => scope.getStore()?.state ?? states.A,
    covers(
      record: unknown,
      evidence: unknown,
      request: unknown,
      expectedEvidence: object,
    ) {
      const b = bound();
      b.state.coverage++;
      assert.deepEqual(record, args.record);
      assert.deepEqual(request, args.request);
      assert.deepEqual(evidence, {
        ...expectedEvidence,
        observedAt: Math.floor(b.time / 1000),
      });
      return true;
    },
    initialOperation() {
      const b = bound();
      assert.equal(b.stage, "A");
      b.state.sourceLoads++;
      return b.operation;
    },
    initialFrame() {
      const b = bound();
      assert.equal(b.stage, "A");
      b.state.pairLoads++;
      return b.frame;
    },
    replayOperation() {
      const b = bound();
      assert.notEqual(b.stage, "A");
      b.state.sourceLoads++;
      return b.operation;
    },
    replayFrame() {
      const b = bound();
      assert.notEqual(b.stage, "A");
      b.state.pairLoads++;
      return b.frame;
    },
  });
}

export type ConfiguredWriteTestFamily = Awaited<
  ReturnType<typeof configureWriteTestFamily>
>;
