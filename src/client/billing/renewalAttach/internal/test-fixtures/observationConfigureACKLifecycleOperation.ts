import assert from "node:assert/strict";
import { vi } from "vitest";
import * as api from "../../../renewalV2/index.js";
import * as observer from "../../../renewalV2/observation.js";
import { configureWriteFixture } from "./configureWriteOperation.js";
import {
  assertConfigureACK,
  assertProviderFailure,
} from "./configureWriteAssertions.js";
import { assertFit } from "./configurePreflightAssertions.js";
import { data } from "./configurePreflightControls.js";
import {
  declareConfigureACKLifecycle,
  type ConfigureACKLifecycleCase,
} from "./observationConfigureACKLifecycleDeclarations.js";
import { installConfigureACKLifecycleInstrumentation } from "./observationConfigureACKLifecycleInstrumentation.js";

/** Negative lifecycle chain. Oracle/admission DATA is never relabeled a returned ACK. */
export async function configureACKLifecycleFixture(
  controlCase: ConfigureACKLifecycleCase,
) {
  const declaration = declareConfigureACKLifecycle(controlCase);
  const instruments = installConfigureACKLifecycleInstrumentation(declaration);
  const pending: Promise<unknown>[] = [];
  let writer: Awaited<ReturnType<typeof configureWriteFixture>> | undefined;
  let originalWriter: Promise<unknown> | undefined;
  let settled = false;
  let lastC6: unknown = null;
  const counters = {
    source: 0,
    target: 0,
    captureEntered: 0,
    captureCompleted: 0,
    C6: 0,
    C3: 0,
    C9: 0,
    lookup: 0,
    lookupReturned: 0,
    lookupThrew: 0,
    observer: 0,
    coverage: 0,
    delegateEntered: 0,
  };
  const calls: { method: string; path: string }[] = [];
  const promises: Promise<unknown>[] = [];
  const clean = async () => {
    writer?.writeGates.release("post");
    try {
      if (originalWriter) await originalWriter.catch(() => {});
      await Promise.all(pending);
      await instruments.join();
    } finally {
      try {
        if (writer) await writer.cleanup();
      } finally {
        instruments.cleanup();
      }
    }
  };
  try {
    writer = await configureWriteFixture(declaration.writerMode);
    const w = writer;
    assert.deepEqual(w.write, declaration.writer);
    assert.equal(
      instruments.state.admissions,
      0,
      "fixture oracle is not operation admission",
    );
    const basis = w.OWNER.basis;
    const savedOriginalRecord = structuredClone(w.expectedRecord);
    const savedOracleACK = structuredClone(w.expectedACK);
    const actualOperation = w.fixedAOperation();
    originalWriter = w.captureWriter().invoke();
    const observedWriter = originalWriter.then(
      (value) => {
        settled = true;
        return { ok: true as const, value };
      },
      (error: unknown) => {
        settled = true;
        return { ok: false as const, error };
      },
    );
    pending.push(observedWriter.then(() => {}));
    let publicWriterACK: unknown = null;
    if (controlCase === "L04-POST-pending") {
      await w.writeGates.entered("post", originalWriter);
      assert.equal(settled, false);
    } else {
      const outcome = await observedWriter;
      if (controlCase === "L05-POST-unknown") {
        assert.equal(outcome.ok, false);
        if (!outcome.ok) assertProviderFailure(w, outcome.error, "post");
      } else {
        assert.equal(outcome.ok, true);
        if (!outcome.ok) assert.fail("EXPECTED_FIXED_WRITER_OUTCOME");
        if (controlCase === "L07-C6Failure-priority") {
          publicWriterACK = outcome.value;
          assertConfigureACK(w, publicWriterACK);
          assert.equal(publicWriterACK, instruments.state.admitted);
        } else assert.deepEqual(outcome.value, declaration.expectedUnknown);
      }
    }
    const writerBefore = Object.freeze({
      records: w.writeState.records.length,
      POST: w.writeState.calls.filter((row) => row.method === "POST").length,
      C9: w.writeState.explicitC9,
    });
    assert.deepEqual(writerBefore, declaration.expectedWriterAtRefusal);
    assert.equal(
      w.writeState.calls.length,
      5 + w.write.currentBundle.couponReads.length,
    );
    const setupBefore = Object.freeze({
      records: w.state.records.length,
      POST: w.state.calls.filter((row) => row.method === "POST").length,
    });
    assert.deepEqual(setupBefore, { records: 3, POST: 1 });
    const stages = instruments.state;
    if (controlCase === "L01-output-abort") {
      assert.equal(stages.admissions, 1);
      assert.equal(stages.outputAborts, 1);
      assert.equal(stages.receiptCalls, 0);
    }
    if (controlCase === "L02-receipt-ACK-fault") {
      assert.equal(stages.admissions, 1);
      assert.equal(stages.wrongACK, 1);
      assert.equal(stages.receiptCalls, 1);
      assert.equal(stages.receiptRejected, 1);
      assert.equal(stages.receiptFulfilled, 0);
    }
    if (controlCase === "L03-final-discard-abort") {
      assert.equal(stages.admissions, 1);
      assert.equal(stages.factoryPairs, 1);
      assert.equal(stages.sourceBindingTrue, 1);
      assert.equal(stages.reservationTrue, 1);
      assert.equal(stages.sameReadTransport, true);
      assert.equal(stages.receiptCalls, 1);
      assert.equal(stages.receiptFulfilled, 1);
      assert.equal(stages.receiptRejected, 0);
      assert.equal(stages.discardEntered, 1);
      assert.equal(stages.discardCompleted, 1);
      assert.equal(w.OWNER.check().retired, false);
    }
    if (controlCase === "L06-receipt-ACK-retire") {
      assert.equal(stages.admissions, 1);
      assert.equal(stages.receiptFulfilled, 1);
      assert.equal(stages.retirements, 1);
      assert.throws(() => w.OWNER.basis, { message: "ORIGINAL_OWNER_STOP" });
    }
    if (
      controlCase === "L04-POST-pending" ||
      controlCase === "L05-POST-unknown"
    ) {
      assert.equal(stages.admissions, 0);
      assert.equal(stages.receiptCalls, 0);
    }
    const candidate =
      controlCase === "L07-C6Failure-priority"
        ? publicWriterACK
        : declaration.known
          ? stages.admitted
          : w.expectedACK;
    assert(candidate !== null && typeof candidate === "object");
    assert.deepEqual(candidate, w.expectedACK);
    assert(Object.isFrozen(candidate));
    const candidateRecord =
      controlCase === "L07-C6Failure-priority"
        ? Object.freeze({
            ...w.expectedRecord,
            configuration: Object.freeze({
              ...w.expectedRecord.configuration,
              apiVersion: declaration.invalidAPI,
            }),
          })
        : w.expectedRecord;
    let directFailure: unknown = null;
    const realRecord = await vi.importActual<
      typeof import("../observation/record.js")
    >("../observation/record.js");
    if (controlCase === "L07-C6Failure-priority") {
      realRecord.captureObservationRecord(candidateRecord);
      directFailure = await Reflect.apply(
        api.projectRenewalConfigurationV2,
        api,
        [candidateRecord.configuration],
      );
      const failure = data(directFailure);
      assert.equal(failure.status, "conflict");
      assert.equal(failure.reason, declaration.expectedC6FailureReason);
      assert.notEqual(candidateRecord, w.expectedRecord);
      assert.deepEqual(w.expectedRecord, savedOriginalRecord);
    }
    const prerequisiteMetrics = {
      originalRecord: assertFit(w.expectedRecord),
      candidateRecord: assertFit(candidateRecord),
      candidateDATA: assertFit(candidate),
    };
    const source = await import("../operations/sourceOperations.js");
    const originalEntry = actualOperation.originalEntry;
    const origin = actualOperation.originAssociation;
    assert.equal(actualOperation.owner, w.OWNER);
    assert.equal(
      actualOperation.actualAttachAcknowledgement,
      w.acknowledgement,
    );
    assert.equal(source.ORIGINAL_ORIGIN_ASSOCIATION, origin);
    assert(source.COMPILED_INITIAL_ENTRIES.includes(originalEntry));
    const readonly = declaration.readonly;
    vi.stubGlobal("fetch", async (input: unknown, init: RequestInit) => {
      const row = readonly.rows[calls.length];
      assert(row);
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.stripe.com");
      assert.equal(url.pathname + url.search, row.path);
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.redirect, "error");
      const headers = new Headers(init.headers);
      assert.equal(
        headers.get("stripe-version"),
        declaration.writer.baseline.apiVersion,
      );
      assert.equal(headers.get("stripe-account"), null);
      calls.push({ method: "GET", path: row.path });
      return new Response(JSON.stringify(row.body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_SYNTHETIC_LIFECYCLE",
        },
      });
    });
    const readTransport = Object.freeze({
      rawRequest(...args: unknown[]) {
        counters.delegateEntered++;
        w.OWNER.check();
        const row = readonly.rows[promises.length];
        assert(row);
        assert.deepEqual(args, ["GET", row.path, undefined, row.options]);
        const promise = w.readFixedA(...args);
        promises.push(promise);
        pending.push(
          promise.then(
            () => {},
            () => {},
          ),
        );
        return promise;
      },
    });
    const observationEntry = Object.freeze({
      originalEntry,
      coversObservation() {
        counters.coverage++;
        throw Error("LIFECYCLE_COVERAGE_MUST_NOT_BE_REACHED");
      },
    });
    const operation = Object.freeze({
      owner: w.OWNER,
      originAssociation: origin,
      originalEntry,
      observationEntry,
      record: candidateRecord,
      actualAttachAcknowledgement: w.acknowledgement,
      readTransport,
      configureOperation: actualOperation,
      configureAcknowledgement: candidate,
    });
    const writerActor = await import("../configure/actor.js");
    const lookup = writerActor.readOwnedConfigureAcknowledgement;
    vi.doMock("../configure/actor.js", () => ({
      ...writerActor,
      readOwnedConfigureAcknowledgement(
        this: unknown,
        ...args: Parameters<typeof lookup>
      ) {
        counters.lookup++;
        try {
          const result = Reflect.apply(lookup, this, args) as ReturnType<
            typeof lookup
          >;
          counters.lookupReturned++;
          return result;
        } catch (error) {
          counters.lookupThrew++;
          throw error;
        }
      },
    }));
    vi.doMock("../observation/record.js", () => ({
      ...realRecord,
      captureObservationRecord(
        this: unknown,
        ...args: Parameters<typeof realRecord.captureObservationRecord>
      ) {
        counters.captureEntered++;
        const result = Reflect.apply(
          realRecord.captureObservationRecord,
          this,
          args,
        ) as ReturnType<typeof realRecord.captureObservationRecord>;
        counters.captureCompleted++;
        return result;
      },
    }));
    vi.doMock("../operations/sourceOperations.js", () => ({
      ...source,
      COMPILED_OBSERVATION_ENTRIES: Object.freeze([observationEntry]),
      loadFixedObservationOperation() {
        assert.equal(arguments.length, 0);
        counters.source++;
        return operation;
      },
    }));
    const keep = <T>(promise: Promise<T>) => {
      pending.push(
        promise.then(
          () => {},
          () => {},
        ),
      );
      return promise;
    };
    vi.doMock("../../../renewalV2/index.js", () => ({
      ...api,
      projectRenewalConfigurationV2(
        ...args: Parameters<typeof api.projectRenewalConfigurationV2>
      ) {
        counters.C6++;
        const promise = Reflect.apply(
          api.projectRenewalConfigurationV2,
          api,
          args,
        ) as ReturnType<typeof api.projectRenewalConfigurationV2>;
        pending.push(
          promise.then(
            (value) => {
              lastC6 = value;
            },
            () => {},
          ),
        );
        return keep(promise);
      },
      constructRenewalScheduleAttachmentReceiptV2(
        ...args: Parameters<
          typeof api.constructRenewalScheduleAttachmentReceiptV2
        >
      ) {
        counters.C3++;
        return keep(
          Reflect.apply(
            api.constructRenewalScheduleAttachmentReceiptV2,
            api,
            args,
          ) as ReturnType<
            typeof api.constructRenewalScheduleAttachmentReceiptV2
          >,
        );
      },
      constructRenewalConfigurationReceiptV2(
        ...args: Parameters<typeof api.constructRenewalConfigurationReceiptV2>
      ) {
        counters.C9++;
        return keep(
          Reflect.apply(
            api.constructRenewalConfigurationReceiptV2,
            api,
            args,
          ) as ReturnType<typeof api.constructRenewalConfigurationReceiptV2>,
        );
      },
    }));
    vi.doMock("../../../renewalV2/observation.js", () => ({
      ...observer,
      inspectRenewalScheduleMaterialV2(
        ...args: Parameters<typeof observer.inspectRenewalScheduleMaterialV2>
      ) {
        counters.observer++;
        return keep(
          Reflect.apply(
            observer.inspectRenewalScheduleMaterialV2,
            observer,
            args,
          ) as ReturnType<typeof observer.inspectRenewalScheduleMaterialV2>,
        );
      },
    }));
    const actor = await import("../observation/actor.js");
    assert.equal(calls.length, 0);
    assert.equal(promises.length, 0);
    assert.deepEqual(counters, {
      source: 0,
      target: 0,
      captureEntered: 0,
      captureCompleted: 0,
      C6: 0,
      C3: 0,
      C9: 0,
      lookup: 0,
      lookupReturned: 0,
      lookupThrew: 0,
      observer: 0,
      coverage: 0,
      delegateEntered: 0,
    });
    console.log(
      JSON.stringify({
        kind: "OPTIONAL_ACK_LIFECYCLE_PREREQUISITES",
        controlCase,
        actualInitialACK: true,
        actualOwnedPreflight: true,
        operationC9Known:
          declaration.known || controlCase === "L07-C6Failure-priority",
        operationReturnedACK: controlCase === "L07-C6Failure-priority",
        candidateKind: declaration.candidateKind,
        writerBefore,
        setupBefore,
        stageMarkers: {
          admissions: stages.admissions,
          receiptFulfilled: stages.receiptFulfilled,
          receiptRejected: stages.receiptRejected,
          wrongACK: stages.wrongACK,
          sourceBindingTrue: stages.sourceBindingTrue,
          discardCompleted: stages.discardCompleted,
        },
        prerequisiteMetrics,
        operationalAuthority: false,
      }),
    );
    return {
      declaration,
      writer: w,
      instruments,
      writerBefore,
      setupBefore,
      basis,
      savedOriginalRecord,
      savedOracleACK,
      operation,
      directFailure,
      counters,
      calls,
      promises,
      lastC6: () => lastC6,
      writerSettled: () => settled,
      capture() {
        const handle = actor.captureOwnedRenewalObservationV2();
        return Object.freeze({
          invoke() {
            counters.target++;
            const promise = Reflect.apply(
              handle.invoke,
              handle,
              [],
            ) as ReturnType<typeof handle.invoke>;
            pending.push(
              promise.then(
                () => {},
                () => {},
              ),
            );
            return promise;
          },
        });
      },
      async finishPendingWriter() {
        assert.equal(controlCase, "L04-POST-pending");
        w.writeGates.release("post");
        const late = await observedWriter;
        assert.equal(late.ok, true);
        if (late.ok) assertConfigureACK(w, late.value);
        console.log(
          JSON.stringify({
            kind: "LIFECYCLE_POST_RELEASE_JOIN",
            operationReturnedACKNow: true,
            writerC9: w.writeState.explicitC9,
            writerRecords: w.writeState.records.length,
            earlierRefusalHadReturnedACK: false,
            operationalAuthority: false,
          }),
        );
      },
      cleanup: clean,
    };
  } catch (error) {
    try {
      await clean();
    } finally {
      throw error;
    }
  }
}
