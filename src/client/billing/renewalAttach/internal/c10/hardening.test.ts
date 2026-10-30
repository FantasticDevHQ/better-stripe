import type { EventRecord } from "./ownData.js";
import "./test-fixtures/semanticSetup.js";
import { it as test } from "vitest";
import assert from "node:assert/strict";
const { fixture, copy, wire, sdk } =
  await import("./test-fixtures/fixture.mjs");
const { createAttachEventCompiler, createConfigureEventCompiler } =
  await import("./test-fixtures/compilerIndex.mjs");
const {
  objectNode: O,
  scalarNode: S,
  eventDigest,
} = await import("./eventCodec.js");
const delivery = () => {
  const records: EventRecord[] = [];
  return {
    records,
    options: {
      timeoutMs: 5000,
      send: async (r: EventRecord, ack: (value: unknown) => void) => {
        records.push(r);
        ack({ sequence: r.sequence, binding: r.binding });
      },
    },
  };
};
test("fully coherent C9 for another body cannot substitute retained same response", async () => {
  const f = await fixture(),
    d = delivery(),
    c = createConfigureEventCompiler(f.sourceConfigure, d.options);
  await c.dispatch({
    event: "dispatch",
    stage: "configure",
    request: f.configure,
  });
  await c.response({
    event: "response",
    stage: "configure",
    request: f.configure,
    body: f.s.configuredBody,
    transport: f.transport,
  });
  const other = copy(f.s.configuredBody);
  other.metadata.c10_full_forgery = "ordinary";
  const forged = await sdk.constructRenewalConfigurationReceiptV2({
    configuration: f.sourceConfigure,
    actualDispatch: wire(f.configure),
    providerSnapshot: other,
    transport: f.transport,
  });
  await assert.rejects(
    c.receipt({
      event: "receipt",
      stage: "configure",
      request: f.configure,
      receipt: forged,
    }),
    /C10_SOURCE_STOP/,
  );
  assert.equal(d.records.length, 2);
});
test("complete C6 status profile and providerQualification compared beyond C6 preimage", async () => {
  const f = await fixture();
  for (const kind of ["status", "profile", "qualification"]) {
    const d = delivery(),
      c = createConfigureEventCompiler(f.sourceConfigure, d.options),
      request = copy(f.configure);
    if (kind === "status") request.status = "forged";
    if (kind === "profile") request.profile.billingMode = "classic";
    if (kind === "qualification") request.providerQualification = "qualified";
    await assert.rejects(
      c.dispatch({ event: "dispatch", stage: "configure", request }),
      /C10_SOURCE_STOP/,
    );
    assert.equal(d.records.length, 0, kind);
  }
});
test("live source Proxy get trap is never used for selected own-data values", async () => {
  const f = await fixture(),
    d = delivery();
  let gets = 0;
  const raw = new Proxy(copy(f.sourceAttach), {
    get() {
      gets++;
      throw Error("GET_TRAP");
    },
  });
  const c = createAttachEventCompiler(raw, d.options);
  await c.dispatch({ event: "dispatch", stage: "attach", request: f.request });
  assert.equal(gets, 0);
  assert.equal(d.records.length, 1);
});
test("response credential text stops before C10 hash or send", async () => {
  const f = await fixture(),
    d = delivery(),
    c = createAttachEventCompiler(f.sourceAttach, d.options);
  await c.dispatch({ event: "dispatch", stage: "attach", request: f.request });
  const body = copy(f.s.attach.providerSnapshot);
  body.extra = "sk_test_SYNTHETIC";
  let hashes = 0;
  const original = globalThis.crypto.subtle.digest;
  globalThis.crypto.subtle.digest = function (...a) {
    hashes++;
    return original.apply(this, a);
  };
  try {
    await assert.rejects(
      c.response({
        event: "response",
        stage: "attach",
        request: f.request,
        body,
        status: 200,
      }),
      /C10_SOURCE_STOP/,
    );
    assert.equal(hashes, 0);
    assert.equal(d.records.length, 1);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
test("stage channels explicitly each start1 and do not establish combined lineage", async () => {
  const f = await fixture(),
    a = delivery(),
    b = delivery(),
    ca = createAttachEventCompiler(f.sourceAttach, a.options),
    cb = createConfigureEventCompiler(f.sourceConfigure, b.options);
  await ca.dispatch({ event: "dispatch", stage: "attach", request: f.request });
  await cb.dispatch({
    event: "dispatch",
    stage: "configure",
    request: f.configure,
  });
  assert.equal(ca.stageChannel, "attach");
  assert.equal(cb.stageChannel, "configure");
  assert.equal(ca.combinedProducerLineageEstablished, false);
  assert.equal(cb.combinedProducerLineageEstablished, false);
  assert.equal(a.records[0].sequence, 1);
  assert.equal(b.records[0].sequence, 1);
  assert.throws(
    () =>
      createAttachEventCompiler(f.sourceAttach, {
        ...a.options,
        startSequence: 9,
      }),
    /C10_SOURCE_STOP/,
  );
});
test("codec raw array-index character budget independently enforced before hash", async () => {
  const array = Object.freeze({
    kind: "array" as const,
    entries: Object.freeze(
      Array.from({ length: 7500 }, (_, i) =>
        Object.freeze([String(i), S(0)] as const),
      ),
    ),
  });
  const node = O([
    ["text", S("x".repeat(480000))],
    ["items", array],
  ]);
  let hashes = 0;
  const original = globalThis.crypto.subtle.digest;
  globalThis.crypto.subtle.digest = function (...a) {
    hashes++;
    return original.apply(this, a);
  };
  try {
    await assert.rejects(eventDigest(node), /C10_SOURCE_STOP/);
    assert.equal(hashes, 0);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
