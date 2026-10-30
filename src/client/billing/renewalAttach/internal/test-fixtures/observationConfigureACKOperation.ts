import assert from "node:assert/strict";
import { vi } from "vitest";
import * as actualPublicAPI from "../../../renewalV2/index.js";
import * as publicObserver from "../../../renewalV2/observation.js";
import {
  declareOptionalConfigureACK18,
  declareOptionalConfigureACKCase,
  type OptionalConfigureACKCase,
  type OptionalConfigureACKControl,
} from "./observationConfigureACKDeclarations.js";
import { configureWriteFixture } from "./configureWriteOperation.js";
import { assertConfigureACK, ackSlots } from "./configureWriteAssertions.js";
import { assertFit } from "./configurePreflightAssertions.js";
import { data, deepFreeze } from "./configurePreflightControls.js";

/** Fixed first18 TEST chain. No production custody/context registrar is introduced. */
export async function optionalConfigureACK18Fixture() {
  return setupOptionalConfigureACK("actual18-default-absent");
}
export async function optionalConfigureACKControlFixture(
  controlCase: OptionalConfigureACKControl,
) {
  return setupOptionalConfigureACK(controlCase);
}
async function setupOptionalConfigureACK(
  controlCase: OptionalConfigureACKCase,
) {
  const selected = declareOptionalConfigureACKCase(controlCase);
  const declaration = selected.declaration;
  if (controlCase === "actual18-default-absent")
    assert.deepEqual(
      declaration,
      declareOptionalConfigureACK18(),
      "ORIGINAL18_WHOLE_DECLARATION_PARITY",
    );
  const writer = await configureWriteFixture(selected.writerMode);
  const pending: Promise<unknown>[] = [];
  const calls: { method: string; path: string }[] = [];
  const promises: Promise<unknown>[] = [];
  const counters = {
    source: 0,
    target: 0,
    coverage: 0,
    observer: 0,
    C6: 0,
    C3: 0,
    C9: 0,
    lookup: 0,
  };
  const clean = async () => {
    try {
      await Promise.all(pending);
    } finally {
      vi.doUnmock("../configure/actor.js");
      vi.doUnmock("../../../renewalV2/observation.js");
      await writer.cleanup();
    }
  };
  try {
    assert.deepEqual(
      writer.write,
      declaration.writer,
      "PREDECLARED_WRITER_RECIPE_PARITY",
    );
    const basis = writer.OWNER.basis;
    const writerACK: unknown = await writer.captureWriter().invoke();
    assertConfigureACK(writer, writerACK);
    const expectedSlots = selected.writerMode === "ack" ? 18 : 19;
    const expectedDefaultsPresent = expectedSlots === 19;
    assert.equal(ackSlots(writer).length, expectedSlots);
    const ack = data(writerACK);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        data(ack.receipt),
        "defaultSettingsBinding",
      ),
      expectedDefaultsPresent,
    );
    const rawReceipt = data(ack.rawReceipt);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        data(rawReceipt.providerSnapshot),
        "default_settings",
      ),
      expectedDefaultsPresent,
    );
    if (expectedDefaultsPresent) {
      const defaults = data(rawReceipt.providerSnapshot).default_settings;
      assert.deepEqual(defaults, declaration.writer.response.default_settings);
      if (selected.writerMode === "defaults-null") assert.equal(defaults, null);
      else assert(defaults !== null && typeof defaults === "object");
      const defaultBinding = data(ack.receipt).defaultSettingsBinding;
      assert.equal(
        defaultBinding,
        writer.expectedReceipt.defaultSettingsBinding,
      );
      assert(typeof defaultBinding === "string");
      assert.match(
        defaultBinding,
        /^renewal-configured-defaults:v2:sha256:[0-9a-f]{64}$/,
      );
    }
    assert.deepEqual(rawReceipt, writer.rawReceipt);
    const phases = data(rawReceipt.providerSnapshot).phases;
    assert(Array.isArray(phases));
    assert.equal(phases.length, 1);
    const actualOperation = writer.fixedAOperation();
    assert.equal(actualOperation.owner, writer.OWNER);
    assert.equal(
      actualOperation.actualAttachAcknowledgement,
      writer.acknowledgement,
    );
    const originalEntry = actualOperation.originalEntry;
    const origin = actualOperation.originAssociation;
    const source = await import("../operations/sourceOperations.js");
    assert.equal(source.ORIGINAL_ORIGIN_ASSOCIATION, origin);
    assert(source.COMPILED_INITIAL_ENTRIES.includes(originalEntry));
    const writerBefore = Object.freeze({
      records: writer.writeState.records.length,
      posts: writer.writeState.calls.filter((row) => row.method === "POST")
        .length,
      c9: writer.writeState.explicitC9,
    });
    assert.deepEqual(writerBefore, { records: 3, posts: 1, c9: 1 });
    const setupBefore = Object.freeze({
      records: writer.state.records.length,
      posts: writer.state.calls.filter((row) => row.method === "POST").length,
    });
    assert.deepEqual(setupBefore, { records: 3, posts: 1 });
    const input = deepFreeze({
      configuration: writer.expectedRecord.configuration,
      reads: declaration.reads,
      configureReceipt: rawReceipt,
    });
    const direct: unknown = await Reflect.apply(
      publicObserver.inspectRenewalScheduleMaterialV2,
      publicObserver,
      [input],
    );
    assert.deepEqual(
      direct,
      declaration.expectedObservation,
      "UNMODIFIED_PUBLIC_OBSERVER_UNKNOWN_PREREQUISITE",
    );
    const expectedOutput = deepFreeze({
      status: "owned_observation_data",
      observation: direct,
      reads: declaration.reads,
      observedAt: declaration.observedAt,
      retainedConfigureAcknowledgement: "present",
      operationalAuthority: false,
    });
    const prerequisites = {
      record: assertFit(writer.expectedRecord),
      actualACK: assertFit(writerACK),
      rawReceipt: assertFit(rawReceipt),
      publicInput: assertFit(input),
      publicResult: assertFit(direct),
      expectedOutput: assertFit(expectedOutput),
    };
    assert.equal(writer.OWNER.basis, basis);
    vi.stubGlobal("fetch", async (value: unknown, init: RequestInit) => {
      const row = declaration.rows[calls.length];
      assert(row, "UNDECLARED_OPTIONAL_ACK_READ");
      const url = new URL(String(value));
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
          "request-id": "req_SYNTHETIC_OPTIONAL_ACK",
        },
      });
    });
    const readTransport = Object.freeze({
      rawRequest(...args: unknown[]) {
        writer.OWNER.check();
        const row = declaration.rows[promises.length];
        assert(row);
        assert.deepEqual(args, ["GET", row.path, undefined, row.options]);
        const promise = writer.readFixedA(...args);
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
      coversObservation(
        record: unknown,
        actualInput: unknown,
        result: unknown,
      ) {
        counters.coverage++;
        assert.deepEqual(record, writer.expectedRecord);
        assert.deepEqual(actualInput, input);
        assert.deepEqual(result, direct);
        return true;
      },
    });
    const operation = Object.freeze({
      owner: writer.OWNER,
      originAssociation: origin,
      originalEntry,
      observationEntry,
      record: writer.expectedRecord,
      actualAttachAcknowledgement: writer.acknowledgement,
      readTransport,
      configureAcknowledgement: writerACK,
      configureOperation: actualOperation,
    });
    let sourceOperation: unknown = operation;
    if (controlCase === "cloned-returnedACK")
      sourceOperation = Object.freeze({
        ...operation,
        configureAcknowledgement: deepFreeze(structuredClone(writerACK)),
      });
    else if (controlCase === "foreign-operation")
      sourceOperation = Object.freeze({
        ...operation,
        configureOperation: Object.freeze({
          declared: "FOREIGN_CONFIGURE_OPERATION",
        }),
      });
    else if (controlCase === "cloned-actual-operation")
      sourceOperation = Object.freeze({
        ...operation,
        configureOperation: Object.freeze({ ...actualOperation }),
      });
    else if (controlCase === "raw-C9-input-instead-of-returnedACK")
      sourceOperation = Object.freeze({
        ...operation,
        configureAcknowledgement: rawReceipt,
      });
    else if (controlCase === "own-ACK-undefined")
      sourceOperation = Object.freeze({
        ...operation,
        configureAcknowledgement: undefined,
      });
    else if (controlCase === "own-ACK-null")
      sourceOperation = Object.freeze({
        ...operation,
        configureAcknowledgement: null,
      });
    else if (
      controlCase === "ACK-present-operation-absent" ||
      controlCase === "operation-present-ACK-absent"
    ) {
      const omitted =
        controlCase === "ACK-present-operation-absent"
          ? "configureOperation"
          : "configureAcknowledgement";
      sourceOperation = Object.freeze(
        Object.fromEntries(
          Object.entries(operation).filter(([key]) => key !== omitted),
        ),
      );
    }
    const actualWriterActor = await import("../configure/actor.js");
    const actualLookup = actualWriterActor.readOwnedConfigureAcknowledgement;
    assert.equal(typeof actualLookup, "function");
    vi.doMock("../configure/actor.js", () => ({
      ...actualWriterActor,
      readOwnedConfigureAcknowledgement(
        this: unknown,
        ...args: Parameters<typeof actualLookup>
      ) {
        counters.lookup++;
        return Reflect.apply(actualLookup, this, args) as ReturnType<
          typeof actualLookup
        >;
      },
    }));
    vi.doMock("../operations/sourceOperations.js", () => ({
      ...source,
      COMPILED_OBSERVATION_ENTRIES: Object.freeze([observationEntry]),
      loadFixedObservationOperation() {
        assert.equal(arguments.length, 0);
        counters.source++;
        return sourceOperation;
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
      ...actualPublicAPI,
      projectRenewalConfigurationV2(
        ...args: Parameters<
          typeof actualPublicAPI.projectRenewalConfigurationV2
        >
      ) {
        counters.C6++;
        return keep(
          Reflect.apply(
            actualPublicAPI.projectRenewalConfigurationV2,
            actualPublicAPI,
            args,
          ) as ReturnType<typeof actualPublicAPI.projectRenewalConfigurationV2>,
        );
      },
      constructRenewalScheduleAttachmentReceiptV2(
        ...args: Parameters<
          typeof actualPublicAPI.constructRenewalScheduleAttachmentReceiptV2
        >
      ) {
        counters.C3++;
        return keep(
          Reflect.apply(
            actualPublicAPI.constructRenewalScheduleAttachmentReceiptV2,
            actualPublicAPI,
            args,
          ) as ReturnType<
            typeof actualPublicAPI.constructRenewalScheduleAttachmentReceiptV2
          >,
        );
      },
      constructRenewalConfigurationReceiptV2(
        ...args: Parameters<
          typeof actualPublicAPI.constructRenewalConfigurationReceiptV2
        >
      ) {
        counters.C9++;
        return keep(
          Reflect.apply(
            actualPublicAPI.constructRenewalConfigurationReceiptV2,
            actualPublicAPI,
            args,
          ) as ReturnType<
            typeof actualPublicAPI.constructRenewalConfigurationReceiptV2
          >,
        );
      },
    }));
    vi.doMock("../../../renewalV2/observation.js", () => ({
      ...publicObserver,
      inspectRenewalScheduleMaterialV2(
        ...args: Parameters<
          typeof publicObserver.inspectRenewalScheduleMaterialV2
        >
      ) {
        counters.observer++;
        const promise = Reflect.apply(
          publicObserver.inspectRenewalScheduleMaterialV2,
          publicObserver,
          args,
        ) as ReturnType<typeof publicObserver.inspectRenewalScheduleMaterialV2>;
        pending.push(
          promise.then(
            () => {},
            () => {},
          ),
        );
        return promise;
      },
    }));
    const actor = await import("../observation/actor.js");
    writer.OWNER.check();
    assert.deepEqual(counters, {
      source: 0,
      target: 0,
      coverage: 0,
      observer: 0,
      C6: 0,
      C3: 0,
      C9: 0,
      lookup: 0,
    });
    assert.equal(calls.length, 0);
    console.log(
      JSON.stringify({
        kind: "OPTIONAL_ACK18_ACTUAL_PREREQUISITES",
        actualInitialACK: true,
        actualWriterACK: true,
        actualConfigureOperationPointer: true,
        sameOriginalOwnerENTRYAndOrigin: true,
        controlCase,
        controlStage: selected.stage,
        generatedSlots: expectedSlots,
        originalClientAndPromisePath: true,
        writerBefore,
        setupBefore,
        observationHTTP: 0,
        directUnmodifiedObserver: direct,
        prerequisites,
        operationalAuthority: false,
      }),
    );
    return {
      declaration,
      selected,
      writer,
      writerACK,
      operation,
      sourceOperation,
      basis,
      input,
      expectedOutput,
      writerBefore,
      setupBefore,
      calls,
      promises,
      counters,
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
      cleanup: clean,
    };
  } catch (error) {
    await clean();
    throw error;
  }
}
