import assert from "node:assert/strict";
import type { configureACKLifecycleFixture } from "./observationConfigureACKLifecycleOperation.js";

export function assertConfigureACKLifecycleResult(
  h: Awaited<ReturnType<typeof configureACKLifecycleFixture>>,
  value: unknown,
) {
  const retired = h.declaration.expectedOwner === "retired";
  const c6Failure = h.declaration.controlCase === "L07-C6Failure-priority";
  if (c6Failure) {
    assert.equal(value, h.lastC6());
    assert.deepEqual(value, h.directFailure);
  } else {
    assert(value instanceof Error);
    assert.equal(
      value.message,
      retired ? "ORIGINAL_OWNER_STOP" : "OWNED_OBSERVATION_STOP",
    );
    for (const key of [
      "failure",
      "cause",
      "rawError",
      "rawReply",
      "headers",
      "token",
    ])
      assert.equal(Object.prototype.hasOwnProperty.call(value, key), false);
  }
  assert.deepEqual(h.counters, {
    source: retired ? 0 : 1,
    target: 1,
    captureEntered: retired ? 0 : 1,
    captureCompleted: retired ? 0 : 1,
    C6: retired ? 0 : 1,
    C3: retired || c6Failure ? 0 : 1,
    C9: 0,
    lookup: retired || c6Failure ? 0 : 1,
    lookupReturned: 0,
    lookupThrew: retired || c6Failure ? 0 : 1,
    observer: 0,
    coverage: 0,
    delegateEntered: 0,
  });
  assert.equal(h.calls.length, 0);
  assert.equal(h.promises.length, 0);
  assert.equal(h.writer.writeState.records.length, h.writerBefore.records);
  assert.equal(
    h.writer.writeState.calls.filter((row) => row.method === "POST").length,
    h.writerBefore.POST,
  );
  assert.equal(h.writer.writeState.explicitC9, h.writerBefore.C9);
  assert.equal(h.writer.state.records.length, h.setupBefore.records);
  assert.equal(
    h.writer.state.calls.filter((row) => row.method === "POST").length,
    h.setupBefore.POST,
  );
  assert.equal(h.operation.configureOperation, h.writer.fixedAOperation());
  assert.equal(
    h.operation.actualAttachAcknowledgement,
    h.writer.acknowledgement,
  );
  assert.deepEqual(h.writer.expectedRecord, h.savedOriginalRecord);
  assert.deepEqual(h.writer.expectedACK, h.savedOracleACK);
  if (retired)
    assert.throws(() => h.writer.OWNER.basis, {
      message: "ORIGINAL_OWNER_STOP",
    });
  else {
    assert.equal(h.writer.OWNER.basis, h.basis);
    assert.equal(h.writer.OWNER.check().retired, false);
  }
  if (h.declaration.controlCase === "L04-POST-pending")
    assert.equal(h.writerSettled(), false);
}
