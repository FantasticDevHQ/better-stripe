import assert from "node:assert/strict";
import { vi } from "vitest";
import { data } from "./configurePreflightControls.js";
import type { configureWriteBarriers } from "./configureWriteBarriers.js";

export function writeObservationState() {
  return {
    phase: "prerequisite",
    trace: [] as string[],
    explicitC3: 0,
    explicitC9: 0,
    compilerC9: 0,
    requests: [] as unknown[],
    delegateArgs: [] as unknown[][],
    replies: [] as unknown[],
    originalPromises: [] as Promise<unknown>[],
    records: [] as Record<string, unknown>[],
    calls: [] as {
      method: string;
      path: string;
      body: unknown;
      key: string | null;
    }[],
    targetCalls: 0,
    reserves: 0,
    pairLoads: 0,
    sourceLoads: 0,
    coverage: 0,
    traps: 0,
    finalAdmission: 0,
    failed: undefined as unknown,
  };
}
export type WriteObservations = ReturnType<typeof writeObservationState>;

/** Writer TEST phase only: preserve selected factory wrappers and original pair identities. */
async function installWriteReadBinding() {
  const selected = await import("../configure/transport.js");
  const readers = new WeakSet<object>();
  vi.doMock("../configure/transport.js", () => ({
    ...selected,
    createConfigureWriteTransport(
      this: unknown,
      ...args: Parameters<typeof selected.createConfigureWriteTransport>
    ) {
      const pair = Reflect.apply(
        selected.createConfigureWriteTransport,
        this,
        args,
      ) as ReturnType<typeof selected.createConfigureWriteTransport>;
      readers.add(pair.transport.readTransport);
      return pair;
    },
    createConfigureReplayTransport(
      this: unknown,
      ...args: Parameters<typeof selected.createConfigureReplayTransport>
    ) {
      const pair = Reflect.apply(
        selected.createConfigureReplayTransport,
        this,
        args,
      ) as ReturnType<typeof selected.createConfigureReplayTransport>;
      readers.add(pair.transport.readTransport);
      return pair;
    },
  }));
  vi.doMock("../acquisition/ownedAcquisition.js", async () => {
    const actual = await vi.importActual<
      typeof import("../acquisition/ownedAcquisition.js")
    >("../acquisition/ownedAcquisition.js");
    return {
      ...actual,
      bindConfigureReadAcquisitionFromSource(
        this: unknown,
        ...args: Parameters<
          typeof actual.bindConfigureReadAcquisitionFromSource
        >
      ) {
        assert(readers.has(args[1]), "WRITER_TEST_PAIR_IDENTITY");
        return Reflect.apply(
          actual.bindConfigureReadAcquisitionFromSource,
          this,
          args,
        ) as ReturnType<typeof actual.bindConfigureReadAcquisitionFromSource>;
      },
    };
  });
}

export async function installWriteAPIObservers(
  current: () => WriteObservations,
  gates: ReturnType<typeof configureWriteBarriers>,
) {
  const actual = await vi.importActual<
    typeof import("../../../renewalV2/index.js")
  >("../../../renewalV2/index.js");
  const observe = <T>(promise: Promise<T>, action: (value: T) => void) => {
    current().originalPromises.push(promise);
    gates.pending.push(promise.then(action, () => {}));
    return promise;
  };
  const publicAPI = {
    ...actual,
    projectRenewalConfigurationV2(
      ...args: Parameters<typeof actual.projectRenewalConfigurationV2>
    ) {
      const s = current();
      s.trace.push("explicit:C6");
      return observe(
        Reflect.apply(actual.projectRenewalConfigurationV2, actual, args),
        (value) => {
          s.requests.push(value);
        },
      );
    },
    constructRenewalScheduleAttachmentReceiptV2(
      this: unknown,
      ...args: Parameters<
        typeof actual.constructRenewalScheduleAttachmentReceiptV2
      >
    ) {
      const state = current();
      state.explicitC3++;
      const promise = Reflect.apply(
        actual.constructRenewalScheduleAttachmentReceiptV2,
        this,
        args,
      ) as ReturnType<
        typeof actual.constructRenewalScheduleAttachmentReceiptV2
      >;
      return observe(promise, () => {});
    },
    constructRenewalConfigurationReceiptV2(
      ...args: Parameters<typeof actual.constructRenewalConfigurationReceiptV2>
    ) {
      const s = current();
      s.explicitC9++;
      s.trace.push("explicit:C9");
      return observe(
        Reflect.apply(
          actual.constructRenewalConfigurationReceiptV2,
          actual,
          args,
        ),
        (value) => {
          s.replies.push(value);
        },
      );
    },
  };
  vi.doMock("../../../renewalV2/index.js", () => publicAPI);
  vi.doMock("../c10/publicApi.js", () => ({
    ...actual,
    constructRenewalConfigurationReceiptV2(
      ...args: Parameters<typeof actual.constructRenewalConfigurationReceiptV2>
    ) {
      const s = current();
      s.compilerC9++;
      s.trace.push("compiler:C9");
      return observe(
        Reflect.apply(
          actual.constructRenewalConfigurationReceiptV2,
          actual,
          args,
        ),
        () => {},
      );
    },
  }));
  await installWriteReadBinding();
  return actual;
}

export function assertActualWriteCounters(s: WriteObservations) {
  assert.equal(s.targetCalls, 1);
  assert.equal(s.reserves, 1);
  assert.equal(s.pairLoads, 1);
  assert.equal(s.calls.filter((r) => r.method === "POST").length, 1);
  assert.equal(s.explicitC9, 1);
  assert.equal(s.compilerC9, 1);
  assert.equal(s.records.length, 3);
  assert.deepEqual(
    s.records.map((v) => data(v.data).event),
    ["dispatch", "response", "receipt"],
  );
}

/** Selected positive TEST diagnostics only: no original ENTRY or Source frame is replaced. */
export function writerFrontierDiagnostics() {
  let retainedStats:
    | ReturnType<typeof import("./attachEntries.js").declaredEntries>["stats"]
    | null = null;
  const counts = {
    entryFactories: 0,
    retainedClassifiers: 0,
    retainedRejected: 0,
    compilerEntered: 0,
    compilerReturned: 0,
    dispatch: 0,
    response: 0,
    receipt: 0,
    c10Fulfilled: 0,
    c10Rejected: 0,
    requestCaptureEntered: 0,
    requestCaptureReturned: 0,
    requestCaptureThrew: 0,
    planCaptureEntered: 0,
    planCaptureReturned: 0,
    planCaptureThrew: 0,
    expectedPlanEntered: 0,
    expectedPlanReturned: 0,
    expectedPlanThrew: 0,
    factoryEntered: 0,
    factoryReturned: 0,
    factoryThrew: 0,
  };
  const retainedStatuses: string[] = [];
  const pending: Promise<unknown>[] = [];
  const samePlanResults: boolean[] = [];
  vi.doMock("../configure/output.js", async () => {
    const actual = await vi.importActual<
      typeof import("../configure/output.js")
    >("../configure/output.js");
    return {
      ...actual,
      captureConfigureRequest(
        this: unknown,
        ...args: Parameters<typeof actual.captureConfigureRequest>
      ) {
        counts.requestCaptureEntered++;
        try {
          const result = Reflect.apply(
            actual.captureConfigureRequest,
            this,
            args,
          ) as ReturnType<typeof actual.captureConfigureRequest>;
          counts.requestCaptureReturned++;
          return result;
        } catch (error) {
          counts.requestCaptureThrew++;
          throw error;
        }
      },
    };
  });
  vi.doMock("../configure/request.js", async () => {
    const actual = await vi.importActual<
      typeof import("../configure/request.js")
    >("../configure/request.js");
    return {
      ...actual,
      capturePlan(
        this: unknown,
        ...args: Parameters<typeof actual.capturePlan>
      ) {
        counts.planCaptureEntered++;
        try {
          const result = Reflect.apply(
            actual.capturePlan,
            this,
            args,
          ) as ReturnType<typeof actual.capturePlan>;
          counts.planCaptureReturned++;
          return result;
        } catch (error) {
          counts.planCaptureThrew++;
          throw error;
        }
      },
      expectedPlan(
        this: unknown,
        ...args: Parameters<typeof actual.expectedPlan>
      ) {
        counts.expectedPlanEntered++;
        try {
          const result = Reflect.apply(
            actual.expectedPlan,
            this,
            args,
          ) as ReturnType<typeof actual.expectedPlan>;
          counts.expectedPlanReturned++;
          return result;
        } catch (error) {
          counts.expectedPlanThrew++;
          throw error;
        }
      },
      samePlan(this: unknown, ...args: Parameters<typeof actual.samePlan>) {
        const result = Reflect.apply(actual.samePlan, this, args) as ReturnType<
          typeof actual.samePlan
        >;
        samePlanResults.push(result);
        return result;
      },
    };
  });
  vi.doMock("../configure/transport.js", async () => {
    const actual = await vi.importActual<
      typeof import("../configure/transport.js")
    >("../configure/transport.js");
    return {
      ...actual,
      createConfigureWriteTransport(
        this: unknown,
        ...args: Parameters<typeof actual.createConfigureWriteTransport>
      ) {
        counts.factoryEntered++;
        try {
          const pair = Reflect.apply(
            actual.createConfigureWriteTransport,
            this,
            args,
          ) as ReturnType<typeof actual.createConfigureWriteTransport>;
          counts.factoryReturned++;
          return pair;
        } catch (error) {
          counts.factoryThrew++;
          throw error;
        }
      },
      createConfigureReplayTransport(
        this: unknown,
        ...args: Parameters<typeof actual.createConfigureReplayTransport>
      ) {
        counts.factoryEntered++;
        try {
          const pair = Reflect.apply(
            actual.createConfigureReplayTransport,
            this,
            args,
          ) as ReturnType<typeof actual.createConfigureReplayTransport>;
          counts.factoryReturned++;
          return pair;
        } catch (error) {
          counts.factoryThrew++;
          throw error;
        }
      },
    };
  });
  vi.doMock("./attachEntries.js", async () => {
    const actual =
      await vi.importActual<typeof import("./attachEntries.js")>(
        "./attachEntries.js",
      );
    return {
      ...actual,
      declaredEntries(
        this: unknown,
        ...args: Parameters<typeof actual.declaredEntries>
      ) {
        counts.entryFactories++;
        const result = Reflect.apply(
          actual.declaredEntries,
          this,
          args,
        ) as ReturnType<typeof actual.declaredEntries>;
        retainedStats = result.stats;
        return result;
      },
    };
  });
  vi.doMock("../material/classifiers.js", async () => {
    const actual = await vi.importActual<
      typeof import("../material/classifiers.js")
    >("../material/classifiers.js");
    return {
      ...actual,
      classifyOwnedRetainedInitialAttachment(
        this: unknown,
        ...args: Parameters<
          typeof actual.classifyOwnedRetainedInitialAttachment
        >
      ) {
        counts.retainedClassifiers++;
        const promise = Reflect.apply(
          actual.classifyOwnedRetainedInitialAttachment,
          this,
          args,
        ) as ReturnType<typeof actual.classifyOwnedRetainedInitialAttachment>;
        pending.push(
          promise.then(
            (value) => {
              retainedStatuses.push(value.status);
            },
            () => {
              counts.retainedRejected++;
            },
          ),
        );
        return promise;
      },
    };
  });
  vi.doMock("../c10/configureEvents.js", async () => {
    const actual = await vi.importActual<
      typeof import("../c10/configureEvents.js")
    >("../c10/configureEvents.js");
    return {
      ...actual,
      createConfigureEventCompiler(
        this: unknown,
        ...args: Parameters<typeof actual.createConfigureEventCompiler>
      ) {
        counts.compilerEntered++;
        const compiler = Reflect.apply(
          actual.createConfigureEventCompiler,
          this,
          args,
        ) as ReturnType<typeof actual.createConfigureEventCompiler>;
        counts.compilerReturned++;
        const observe = <T>(promise: Promise<T>) => {
          pending.push(
            promise.then(
              () => {
                counts.c10Fulfilled++;
              },
              () => {
                counts.c10Rejected++;
              },
            ),
          );
          return promise;
        };
        return Object.freeze({
          ...compiler,
          dispatch(...args: Parameters<typeof compiler.dispatch>) {
            counts.dispatch++;
            return observe(
              Reflect.apply(compiler.dispatch, compiler, args) as ReturnType<
                typeof compiler.dispatch
              >,
            );
          },
          response(...args: Parameters<typeof compiler.response>) {
            counts.response++;
            return observe(
              Reflect.apply(compiler.response, compiler, args) as ReturnType<
                typeof compiler.response
              >,
            );
          },
          receipt(...args: Parameters<typeof compiler.receipt>) {
            counts.receipt++;
            return observe(
              Reflect.apply(compiler.receipt, compiler, args) as ReturnType<
                typeof compiler.receipt
              >,
            );
          },
        });
      },
    };
  });
  return Object.freeze({
    log(
      state: WriteObservations | undefined,
      preflightReaderBindings?: number,
    ) {
      const statuses =
        state?.requests.map((value) => {
          if (value === null || typeof value !== "object") return "non-object";
          const descriptor = Object.getOwnPropertyDescriptor(value, "status");
          return descriptor &&
            "value" in descriptor &&
            typeof descriptor.value === "string" &&
            descriptor.value.length <= 64
            ? descriptor.value
            : "other";
        }) ?? null;
      const last = retainedStats?.lastRetainedResult;
      console.log(
        JSON.stringify({
          kind: "WRITER_PREDISPATCH_FRONTIER_DIAGNOSTIC",
          sourceLoads: state?.sourceLoads ?? null,
          C6:
            state?.trace.filter((value) => value === "explicit:C6").length ??
            null,
          C6Statuses: statuses,
          C3: state?.explicitC3 ?? null,
          pairLoads: state?.pairLoads ?? null,
          reserves: state?.reserves ?? null,
          GETs:
            state?.calls.filter((value) => value.method === "GET").length ??
            null,
          POSTs:
            state?.calls.filter((value) => value.method === "POST").length ??
            null,
          coverage: state?.coverage ?? null,
          records: state?.records.length ?? null,
          retainedCalls: retainedStats?.retainedCalls ?? null,
          retainedMatches: retainedStats?.retainedMatches ?? null,
          retainedResult:
            last === true || last === false || last === 1 || last === null
              ? last
              : "other",
          retainedStatuses,
          preflightReaderBindings: preflightReaderBindings ?? null,
          samePlanResults,
          counts,
          SourceLoadsCountSuccessfulBoundLookupOnly: true,
        }),
      );
    },
    async cleanup() {
      await Promise.allSettled(pending);
      vi.doUnmock("./attachEntries.js");
      vi.doUnmock("../material/classifiers.js");
      vi.doUnmock("../c10/configureEvents.js");
      vi.doUnmock("../configure/output.js");
      vi.doUnmock("../configure/request.js");
      vi.doUnmock("../configure/transport.js");
    },
  });
}
