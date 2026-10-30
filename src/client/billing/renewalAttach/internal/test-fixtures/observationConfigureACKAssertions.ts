import assert from "node:assert/strict";
import { data } from "./configurePreflightControls.js";
import { assertFit } from "./configurePreflightAssertions.js";
import type { optionalConfigureACK18Fixture } from "./observationConfigureACKOperation.js";

export function assertOptionalConfigureACK18(
  h: Awaited<ReturnType<typeof optionalConfigureACK18Fixture>>,
  output: unknown,
) {
  assert.deepEqual(output, h.expectedOutput);
  const out = data(output);
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
  assert.equal(out.retainedConfigureAcknowledgement, "present");
  assert.equal(out.operationalAuthority, false);
  assert.equal(h.counters.target, 1);
  assert.equal(h.counters.source, 1);
  assert.equal(h.counters.coverage, 1);
  assert.equal(h.counters.observer, 1);
  assert.equal(h.counters.C6, 1);
  assert.equal(h.counters.C3, 1);
  assert.equal(h.counters.C9, 1);
  assert.equal(h.counters.lookup, 1);
  assert.notEqual(output, h.expectedOutput);
  assert.notEqual(out.reads, h.declaration.reads);
  assert.notEqual(data(out.reads).schedule, h.declaration.reads.schedule);
  assert.notEqual(out.observation, data(h.expectedOutput).observation);
  assert.equal(h.writer.writeState.explicitC9, h.writerBefore.c9);
  assert.equal(h.calls.length, 6);
  assert.equal(h.promises.length, 6);
  assert.deepEqual(
    h.calls,
    h.declaration.rows.map((row) => ({ method: "GET", path: row.path })),
  );
  assert.equal(h.writer.writeState.records.length, h.writerBefore.records);
  assert.equal(
    h.writer.writeState.calls.filter((row) => row.method === "POST").length,
    h.writerBefore.posts,
  );
  assert.equal(h.writer.state.records.length, h.setupBefore.records);
  assert.equal(
    h.writer.state.calls.filter((row) => row.method === "POST").length,
    h.setupBefore.posts,
  );
  assert.equal(h.writer.OWNER.basis, h.basis);
  assert.equal(h.operation.configureOperation, h.writer.fixedAOperation());
  assert.equal(h.operation.configureAcknowledgement, h.writerACK);
  assert.equal(
    h.operation.actualAttachAcknowledgement,
    h.writer.acknowledgement,
  );
  assertFit(output);
  const frozen = (value: unknown) => {
    if (value && typeof value === "object") {
      assert(Object.isFrozen(value));
      for (const child of Object.values(value)) frozen(child);
    }
  };
  frozen(output);
}

export function assertOptionalConfigureACKRefusal(
  h: Awaited<ReturnType<typeof optionalConfigureACK18Fixture>>,
  error: unknown,
) {
  assert.notEqual(h.selected.stage, "positive");
  assert(error instanceof Error);
  assert.equal(error.message, "OWNED_OBSERVATION_STOP");
  for (const key of [
    "failure",
    "cause",
    "rawError",
    "rawReply",
    "headers",
    "token",
  ])
    assert.equal(Object.prototype.hasOwnProperty.call(error, key), false);
  const grammar = h.selected.stage === "grammar";
  assert.deepEqual(h.counters, {
    source: 1,
    target: 1,
    coverage: 0,
    observer: 0,
    C6: grammar ? 0 : 1,
    C3: grammar ? 0 : 1,
    C9: 0,
    lookup: grammar ? 0 : 1,
  });
  assert.equal(h.calls.length, 0);
  assert.equal(h.promises.length, 0);
  assert.equal(h.writer.writeState.explicitC9, h.writerBefore.c9);
  assert.equal(h.writer.writeState.records.length, h.writerBefore.records);
  assert.equal(
    h.writer.writeState.calls.filter((row) => row.method === "POST").length,
    h.writerBefore.posts,
  );
  assert.equal(h.writer.state.records.length, h.setupBefore.records);
  assert.equal(
    h.writer.state.calls.filter((row) => row.method === "POST").length,
    h.setupBefore.posts,
  );
  assert.equal(h.writer.OWNER.basis, h.basis);
  assert.equal(h.writer.OWNER.check().retired, false);
  assert.equal(h.operation.configureOperation, h.writer.fixedAOperation());
  assert.equal(h.operation.configureAcknowledgement, h.writerACK);
}
