import assert from "node:assert/strict";
import { data } from "./configurePreflightControls.js";
import { assertFit } from "./configurePreflightAssertions.js";
import type { ObservationFixture } from "./observationOperation.js";

export function logObservationPrerequisites(h: {
  initialOutput: unknown;
  record: unknown;
  input: unknown;
  expectedOutput: unknown;
  calls: number;
  targetCalls: number;
}) {
  assert.equal(h.calls, 0);
  assert.equal(h.targetCalls, 0);
  for (const part of [
    "initialOutput",
    "record",
    "input",
    "expectedOutput",
  ] as const)
    console.log(
      JSON.stringify({
        kind: "REPOSITORY_OBSERVATION_PREREQUISITE_METRICS",
        part,
        ...assertFit(h[part]),
      }),
    );
  console.log(
    JSON.stringify({
      kind: "REPOSITORY_OBSERVATION_PREREQUISITES",
      actualInitialACK: true,
      actualSourceENTRYAndOwner: true,
      actualACKPointer: true,
      actualCurrentC6: true,
      directUnchangedObserver: "attached_unconfigured_match",
      observationHTTP: 0,
      targetCalls: 0,
      retainedConfigureAcknowledgement: "absent",
      operationalAuthority: false,
    }),
  );
}

export function assertObservationOutput(h: ObservationFixture, value: unknown) {
  assert.deepEqual(value, h.expectedOutput);
  const out = data(value);
  assert.notEqual(value, h.expectedOutput);
  assert.notEqual(out.reads, h.declaration.reads);
  assert.deepEqual(
    Object.keys(out).sort(),
    [
      "status",
      "observation",
      "reads",
      "observedAt",
      "retainedConfigureAcknowledgement",
      "operationalAuthority",
    ].sort(),
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(h.input, "configureReceipt"),
    false,
  );
  assert.equal(h.state.targetCalls, 1);
  assert.equal(h.state.sourceLoads, 1);
  assert.equal(h.http.calls.length, h.declaration.rows.length);
  assert.equal(h.declaration.rows.length, 6);
  for (const [i, row] of h.http.calls.entries()) {
    assert.equal(row.method, "GET");
    assert.equal(row.path, h.declaration.rows[i]!.path);
  }
  assert.equal(h.state.ownedC6, 1);
  assert.equal(h.state.ownedC3, 1);
  assert.equal(h.state.ownedC9, 0);
  assert.equal(h.state.ownedObserver, 1);
  assert.equal(h.state.coverage, 1);
  const sample = h.http.finalSample();
  assert(sample);
  assert.equal(out.observedAt, Math.floor(sample.wallMs / 1000));
  assert.equal(h.prerequisite.deltas().records, 0);
  assert.equal(h.prerequisite.deltas().POST, 0);
  assertFit(h.record);
  assertFit(h.input);
  assertFit(value);
  const frozen = (x: unknown) => {
    if (x && typeof x === "object") {
      assert(Object.isFrozen(x));
      for (const child of Object.values(x)) frozen(child);
    }
  };
  frozen(value);
}

export function assertNoObservationReads(h: ObservationFixture) {
  assert.equal(h.http.calls.length, 0);
  assert.equal(h.http.argsSeen.length, 0);
  assert.equal(h.http.delegateEntriesAfterOwner(), 0);
  assert.equal(h.http.originals.length, 0);
  assert.equal(h.prerequisite.deltas().POST, 0);
  assert.equal(h.prerequisite.deltas().records, 0);
  assert.equal(h.state.ownedC9, 0);
  assert.equal(h.state.ownedObserver, 0);
  assert.equal(h.state.coverage, 0);
}
export function assertPrivateObservationError(
  error: unknown,
  expected:
    | "OWNED_OBSERVATION_STOP"
    | "OWNED_OBSERVATION_ONCE"
    | "ORIGINAL_OWNER_STOP"
    | "MATERIAL_V2_UNSUPPORTED" = "OWNED_OBSERVATION_STOP",
) {
  assert(error instanceof Error);
  assert.equal(error.message, expected);
  assert.notEqual(error.message, "OWNED_OBSERVATION_PROVIDER_REJECTED");
  assert.equal(Object.prototype.hasOwnProperty.call(error, "failure"), false);
}
export async function observationOutcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

export function assertObservationReadPrefix(
  h: ObservationFixture,
  count: number,
) {
  assert.equal(h.declaration.rows.length, 6);
  assert.equal(h.http.calls.length, count);
  assert.equal(h.http.argsSeen.length, count);
  assert.equal(h.http.delegateEntries(), count);
  assert.equal(h.http.delegateEntriesAfterOwner(), count);
  assert.equal(h.http.originals.length, count);
  for (let i = 0; i < count; i++) {
    const row = h.declaration.rows[i]!;
    assert.deepEqual(h.http.calls[i], { method: "GET", path: row.path });
    assert.deepEqual(h.http.argsSeen[i], [
      "GET",
      row.path,
      undefined,
      row.options,
    ]);
    assert(h.http.originals[i] instanceof Promise);
  }
  assert.equal(h.state.sourceLoads, 1);
  assert.equal(h.state.ownedC6, 1);
  assert.equal(h.state.ownedC3, 1);
  assert.equal(h.state.C3Fulfilled, 1);
  assert.equal(h.state.recordVerificationCompleted, 1);
  assert.equal(h.state.ownedObserver, 0);
  assert.equal(h.state.coverage, 0);
  assert.equal(h.state.ownedC9, 0);
  assert.equal(h.prerequisite.state.pairLoads, 0);
  assert.equal(h.prerequisite.state.readonlyCalls, 0);
  assert.equal(h.prerequisite.deltas().POST, 0);
  assert.equal(h.prerequisite.deltas().records, 0);
}
export function assertObservationProviderFailure(
  h: ObservationFixture,
  error: unknown,
) {
  assert(error instanceof Error);
  assert.equal(error.message, "OWNED_OBSERVATION_PROVIDER_REJECTED");
  assert.equal(Object.prototype.hasOwnProperty.call(error, "cause"), false);
  const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
  assert(
    descriptor &&
      "value" in descriptor &&
      !descriptor.enumerable &&
      !descriptor.writable &&
      !descriptor.configurable,
  );
  const row = h.declaration.rows[h.declaration.transport.ordinal - 1]!;
  const failure = data(descriptor.value);
  assert.deepEqual(failure, {
    category: "provider_rejected",
    phase: "read",
    resource: row.resource,
    ordinal: row.ordinal,
    request: {
      method: "GET",
      path: row.path,
      apiVersion: h.declaration.baseline.apiVersion,
    },
    diagnostics: h.declaration.transport.expectedDiagnostics,
    outcome: "unknown",
    operationalAuthority: false,
  });
  assert.deepEqual(
    Object.keys(failure).sort(),
    [
      "category",
      "phase",
      "resource",
      "ordinal",
      "request",
      "diagnostics",
      "outcome",
      "operationalAuthority",
    ].sort(),
  );
  for (const value of [failure, failure.request, failure.diagnostics])
    assert(Object.isFrozen(value));
  for (const key of ["rawError", "rawReply", "headers", "token"])
    assert.equal(Object.prototype.hasOwnProperty.call(failure, key), false);
  assert.equal(h.http.actualError(), h.http.transformedError());
  assert(h.http.actualError() instanceof Error);
  assert.equal(h.http.errorConfigurationVerified(), 1);
}
