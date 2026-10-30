import assert from "node:assert/strict";
import { types } from "node:util";
import {
  declareObservationPositive,
  type ObservationControl,
} from "./observationDeclarations.js";
import { configurePreflightFixture } from "./configurePreflightOperation.js";
import { data, deepFreeze } from "./configurePreflightControls.js";
import { observationHTTP } from "./observationHTTP.js";
import {
  observationState,
  observeObservationAPI,
  joinObservationWork,
  cleanObservationAPI,
  installTrustedExportCase,
} from "./observationObservations.js";
import { vi } from "vitest";
import { logObservationPrerequisites } from "./observationAssertions.js";
import { controlOperation } from "./observationProbe.js";

/** Complete positive setup; no module reset after actual Owner/ENTRY/ACK capture. */
export async function observationFixture(
  controlCase: ObservationControl = "positive",
) {
  const declaration = declareObservationPositive(controlCase);
  const state = observationState();
  const prerequisite = await configurePreflightFixture("positive");
  try {
    const { OWNER } = await import("../originalOwner.js");
    assert.equal(OWNER, prerequisite.OWNER);
    const basis = OWNER.basis;
    assert.equal(basis, prerequisite.basis);
    const source = await import("../operations/sourceOperations.js");
    assert.equal(source.COMPILED_INITIAL_ENTRIES.length, 1);
    const entry = source.COMPILED_INITIAL_ENTRIES[0];
    assert(entry && typeof entry === "object" && !types.isProxy(entry));
    const retained = Object.getOwnPropertyDescriptor(entry, "coversRetained");
    assert(
      retained && "value" in retained && typeof retained.value === "function",
    );
    const initialOperation = data(source.loadFixedInitialOperation());
    assert.equal(initialOperation.owner, OWNER);
    assert.equal(
      initialOperation.originAssociation,
      source.ORIGINAL_ORIGIN_ASSOCIATION,
    );
    assert(
      source.ORIGINAL_ORIGIN_ASSOCIATION &&
        !types.isProxy(source.ORIGINAL_ORIGIN_ASSOCIATION),
    );
    assert.deepEqual(prerequisite.declared, declaration.baseline);
    assert.equal(
      data(prerequisite.initialOutput).status,
      "attach_acknowledged",
    );
    assert.equal(prerequisite.state.records.length, 3);
    assert.equal(
      prerequisite.state.calls.filter((r) => r.method === "POST").length,
      1,
    );
    const record = prerequisite.expectedRecord;
    assert.equal(record.attachReceipt, prerequisite.acknowledgement);
    assert.equal(prerequisite.boundRecord, record);
    assert.deepEqual(
      record.originalBundle,
      declaration.baseline.original.originalBundle,
    );
    assert.deepEqual(
      data(prerequisite.acknowledgement).providerSnapshot,
      declaration.reads.schedule,
    );
    const now = OWNER.check();
    assert.equal(now.wallMs, declaration.expectedOwnerAt);
    assert(now.wallMs > declaration.originalFirstAt + 60000);
    assert.equal(now.nowSeconds - declaration.retentionEpoch, 61);
    assert.equal(prerequisite.state.pairLoads, 0);
    assert.equal(prerequisite.state.readonlyCalls, 0);
    assert.equal(prerequisite.state.coverage, 0);
    assert.deepEqual(prerequisite.deltas(), { GET: 0, POST: 0, records: 0 });
    // No preflight capture/invoke is called: its readonly Schedule-last pair stays unused.
    const { configuration: actual, observation: observer } =
      await observeObservationAPI(state, OWNER, controlCase);
    OWNER.check();
    const desired = await actual.projectRenewalConfigurationV2(
      record.configuration,
    );
    OWNER.check();
    assert.equal(
      desired.status,
      "projected_configure_request",
      "ACTUAL_CURRENT_C6_PREREQUISITE",
    );
    assert.deepEqual(desired, record.request);
    const input = deepFreeze({
      configuration: record.configuration,
      reads: declaration.reads,
    });
    const oracle = await observer.inspectRenewalScheduleMaterialV2(input);
    OWNER.check();
    assert.deepEqual(
      oracle,
      declaration.expected,
      "ACTUAL_CURRENT_OBSERVER_APPLICABILITY",
    );
    const http = await observationHTTP(declaration, OWNER);
    OWNER.check();
    const expectedOutput = deepFreeze({
      status: "owned_observation_data",
      observation: declaration.expected,
      reads: declaration.reads,
      observedAt: now.nowSeconds,
      retainedConfigureAcknowledgement: "absent",
      operationalAuthority: false,
    });
    const observationEntry = Object.freeze({
      originalEntry: entry,
      coversObservation(
        candidateRecord: unknown,
        candidateInput: unknown,
        result: unknown,
      ) {
        state.coverage++;
        assert.deepEqual(candidateRecord, record);
        assert.deepEqual(candidateInput, input);
        assert.deepEqual(result, oracle);
        return true;
      },
    });
    // Prospective TEST tuple only, not registered in an alternate registry or Source.
    const operation = Object.freeze({
      owner: OWNER,
      originAssociation: source.ORIGINAL_ORIGIN_ASSOCIATION,
      originalEntry: entry,
      observationEntry,
      record,
      actualAttachAcknowledgement: prerequisite.acknowledgement,
      readTransport: http.delegate,
    });
    assert.equal(operation.originalEntry, source.COMPILED_INITIAL_ENTRIES[0]);
    assert.equal(
      operation.record.attachReceipt,
      operation.actualAttachAcknowledgement,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        operation,
        "configureAcknowledgement",
      ),
      false,
    );
    assert.deepEqual(
      [
        state.sourceLoads,
        state.ownedC6,
        state.ownedC3,
        state.ownedC9,
        state.ownedObserver,
        state.coverage,
        state.targetCalls,
      ],
      [0, 0, 0, 0, 0, 0, 0],
    );
    assert.equal(OWNER.basis, basis);
    logObservationPrerequisites({
      initialOutput: prerequisite.initialOutput,
      record,
      input,
      expectedOutput,
      calls: http.calls.length,
      targetCalls: state.targetCalls,
    });
    console.log(
      JSON.stringify({
        kind: "OBSERVATION_CONTROL_DECLARATION",
        controlCase,
        baselinePrerequisitesOnly: controlCase !== "positive",
        expectedOwner: declaration.expectedOwner,
        rawFaultRecipeDeclaredBeforeConstructors: true,
        operationalAuthority: false,
      }),
    );
    const sourceOperation = controlOperation(operation, declaration, state);
    await installTrustedExportCase(state, OWNER, declaration);
    OWNER.check();
    // Fixed TEST Source only. Preserve the writer's and initial actor's aliases.
    const normalSource = await vi.importActual<
      typeof import("../operations/sourceOperations.js")
    >("../operations/sourceOperations.js");
    vi.doMock("../operations/sourceOperations.js", () => ({
      ...normalSource,
      ...source,
      COMPILED_OBSERVATION_ENTRIES: Object.freeze([observationEntry]),
      loadFixedObservationOperation() {
        assert.equal(arguments.length, 0);
        state.sourceLoads++;
        return sourceOperation;
      },
    }));
    const actor = await import("../observation/actor.js");
    OWNER.check();
    return {
      prerequisite,
      actual,
      actor,
      controlCase,
      sourceOperation,
      declaration,
      state,
      OWNER,
      basis,
      record,
      input,
      operation,
      http,
      expectedOutput,
      capture(...args: unknown[]) {
        const handle = Reflect.apply(
          actor.captureOwnedRenewalObservationV2,
          actor,
          args,
        ) as ReturnType<typeof actor.captureOwnedRenewalObservationV2>;
        return Object.freeze({
          invoke(...invokeArgs: unknown[]) {
            state.targetCalls++;
            return Reflect.apply(
              handle.invoke,
              handle,
              invokeArgs,
            ) as ReturnType<typeof handle.invoke>;
          },
        });
      },
      async cleanup() {
        try {
          await http.cleanup();
          await joinObservationWork(state);
          assert.equal(record.attachReceipt, prerequisite.acknowledgement);
          if (declaration.expectedOwner === "retired")
            assert.throws(() => OWNER.basis, {
              name: "Error",
              message: "ORIGINAL_OWNER_STOP",
            });
          else assert.equal(OWNER.basis, basis);
          assert.equal(prerequisite.state.records.length, 3);
          assert.equal(
            prerequisite.state.calls.filter((r) => r.method === "POST").length,
            1,
          );
        } finally {
          http.hold.release.resolve();
          cleanObservationAPI();
          await prerequisite.cleanup();
        }
      },
    };
  } catch (error) {
    cleanObservationAPI();
    await prerequisite.cleanup();
    throw error;
  }
}
export type ObservationFixture = Awaited<ReturnType<typeof observationFixture>>;
