import type { EventRecord } from "./ownData.js";
import "./test-fixtures/semanticSetup.js";
import { it as test } from "vitest";
import assert from "node:assert/strict";
const { createAppendAckAdapter } = await import("./appendAck.js");
const {
  objectNode: O,
  scalarNode: S,
  eventDigest,
} = await import("./eventCodec.js");
const data = () =>
  O([
    ["event", S("dispatch")],
    ["stage", S("attach")],
    ["request", S(null)],
  ]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("fixed C10 four-element known answer and no caller family selector", async () => {
  const value = await eventDigest(
    O([
      ["sequence", S(1)],
      ["data", S(null)],
    ]),
  );
  assert.equal(
    value,
    "unbound-qualification-event:v2:sha256:a591e9d0f61ec0ea22a004efbb53b9c151aa3f2f52691cd6bde1234d8aae7e31",
  );
  assert.equal(eventDigest.length, 1);
});
test("codec full UTF8 tuple bound rejects before digest", async () => {
  let hashes = 0;
  const original = globalThis.crypto.subtle.digest;
  globalThis.crypto.subtle.digest = function (...args) {
    hashes++;
    return original.apply(this, args);
  };
  try {
    await assert.rejects(
      eventDigest(O([["large", S("é".repeat(250000))]])),
      /C10_SOURCE_STOP/,
    );
    assert.equal(hashes, 0);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
test("append needs send fulfillment AND exact ACK even if ACK synchronous", async () => {
  let release!: () => void,
    acknowledge!: (value: unknown) => void,
    completed = false,
    startedResolve!: () => void;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send: (r: EventRecord, ack: (value: unknown) => void) => {
      acknowledge = ack;
      ack({ sequence: r.sequence, binding: r.binding });
      return new Promise<void>((resolve) => {
        release = resolve;
        startedResolve();
      });
    },
  });
  const p = append(data()).then(() => {
    completed = true;
  });
  await started;
  assert.equal(completed, false);
  release();
  await p;
  assert.equal(completed, true);
  acknowledge({ sequence: 1, binding: "bad" });
  await assert.rejects(append(data()), /C10_SOURCE_STOP/);
});
test("synchronous append reservation rejects second hash while first may commit as old core", async () => {
  let sent = 0;
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send: async (r: EventRecord, ack: (value: unknown) => void) => {
      sent++;
      ack({ sequence: r.sequence, binding: r.binding });
    },
  });
  const a = append(data()),
    b = append(data());
  await Promise.all([a, assert.rejects(b, /C10_SOURCE_STOP/)]);
  assert.equal(sent, 1);
});
test("deferred hash beyond original timer rejects and late hash never sends", async () => {
  const original = globalThis.crypto.subtle.digest;
  let release!: () => void,
    sent = 0;
  globalThis.crypto.subtle.digest = () =>
    new Promise((resolve) => {
      release = () => resolve(new ArrayBuffer(32));
    });
  try {
    const append = createAppendAckAdapter({
      timeoutMs: 5,
      send: async () => {
        sent++;
      },
    });
    await assert.rejects(append(data()), /C10_SOURCE_STOP/);
    assert.equal(sent, 0);
    release();
    await tick();
    assert.equal(sent, 0);
    await assert.rejects(append(data()), /C10_SOURCE_STOP/);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
test("send rejection after matching ACK remains failure and permanently closed", async () => {
  const append = createAppendAckAdapter({
    timeoutMs: 5000,
    send: async (r: EventRecord, ack: (value: unknown) => void) => {
      ack({ sequence: r.sequence, binding: r.binding });
      throw Error("PRIVATE_ERROR_NOT_EXPORTED");
    },
  });
  await assert.rejects(
    append(data()),
    (e) => (e as Error).message === "C10_SOURCE_STOP",
  );
  await assert.rejects(append(data()), /C10_SOURCE_STOP/);
});
test("missing send completion times out despite ACK, no automatic retry", async () => {
  let sends = 0;
  const append = createAppendAckAdapter({
    timeoutMs: 5,
    send: (r: EventRecord, ack: (value: unknown) => void) => {
      sends++;
      ack({ sequence: r.sequence, binding: r.binding });
      return new Promise(() => {});
    },
  });
  await assert.rejects(append(data()), /C10_SOURCE_STOP/);
  await assert.rejects(append(data()), /C10_SOURCE_STOP/);
  assert.equal(sends, 1);
});
test("wrong duplicate and late ACK reject permanently without raw logging", async () => {
  for (const mode of ["wrong", "duplicate", "late"]) {
    let ackFn!: (value: unknown) => void, record!: EventRecord;
    const append = createAppendAckAdapter({
      timeoutMs: 5,
      send: async (r: EventRecord, ack: (value: unknown) => void) => {
        record = r;
        ackFn = ack;
        if (mode === "wrong") ack({ sequence: 99, binding: r.binding });
        if (mode === "duplicate") {
          ack({ sequence: r.sequence, binding: r.binding });
          ack({ sequence: r.sequence, binding: r.binding });
        }
      },
    });
    await assert.rejects(append(data()), /C10_SOURCE_STOP/);
    if (mode === "late")
      ackFn({ sequence: record.sequence, binding: record.binding });
    await assert.rejects(append(data()), /C10_SOURCE_STOP/);
  }
});
test("crypto error is fixed failure without fallback or send", async () => {
  const original = globalThis.crypto.subtle.digest;
  let sent = 0;
  globalThis.crypto.subtle.digest = () =>
    Promise.reject(Error("PRIVATE_ERROR_NOT_EXPORTED"));
  try {
    const append = createAppendAckAdapter({
      timeoutMs: 5000,
      send: async () => {
        sent++;
      },
    });
    await assert.rejects(
      append(data()),
      (e) => (e as Error).message === "C10_SOURCE_STOP",
    );
    assert.equal(sent, 0);
  } finally {
    globalThis.crypto.subtle.digest = original;
  }
});
