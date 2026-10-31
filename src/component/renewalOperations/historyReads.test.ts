import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
import { renewalSnapshot } from "../../client/billing/renewalReplacementSnapshot.js";
import {
  eventDigest,
  materialize,
  objectNode,
  scalarNode,
} from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";

const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
const append = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:appendStageEvent",
);
const readEvent = makeFunctionReference<"query">(
  "renewalOperations/queries:readStageEvent",
);

// Independent immutable storage DATA, never a qualified producer or Owner.
const record = Object.freeze({
  schemaVersion: 1,
  requestBinding: "scoped-history-storage-only",
  authorization: Object.freeze({
    scope: "history-scope",
    id: "history-consent",
    revision: 1,
  }),
  logicalOperationId: "history-read-small",
  profile: "unqualified-storage-DATA",
  stage: "attach",
  apiVersion: "2026-09-30.endive",
  account: Object.freeze({
    mode: "platform",
    stripeAccount: null,
    livemode: false,
  }),
  dispatch: Object.freeze({
    scope: "platform",
    apiVersion: "2026-09-30.endive",
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: Object.freeze({ from_subscription: "sub_history" }),
    key: "history-storage-key",
    firstDispatchedAt: 2000000000,
  }),
  basis: Object.freeze({
    startWallMs: 2000000000000,
    startNs: "1000000000",
    workEndWallMs: 2000000004000,
    workEndNs: "5000000000",
    endWallMs: 2000000005000,
    endNs: "6000000000",
  }),
});
const recordJSON = JSON.stringify(renewalSnapshot(record));
const eventData = Object.freeze({
  event: "unqualified-storage-history",
  padding: "complete-small-event",
});
const dataJSON = JSON.stringify(renewalSnapshot(eventData));
const limit = 1048576;
afterEach(() => vi.unstubAllGlobals());

it("R01 scoped event query returns the complete committed event and descriptor", async () => {
  let fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  const t = convexTest(schema, modules);
  function fits(value: Parameters<typeof getConvexSize>[0]) {
    expect(getConvexSize(value) <= limit).toBe(true);
  }
  const creation = {
    authorizationScope: record.authorization.scope,
    logicalOperationId: record.logicalOperationId,
    authorizationRevision: record.authorization.revision,
    recordJSON,
  };
  fits(creation);
  const op = await t.mutation(create, creation);
  expect(op.status).toBe("created");
  fits(op);
  const loadArgs = { operationId: op.operationId };
  fits(loadArgs);
  const original = await t.query(load, loadArgs);
  fits(original);
  expect(original.recordJSON).toBe(recordJSON);
  expect(original.revision).toBe(0);
  expect(original.activeAttempt).toBeNull();
  const reserveArgs = {
    operationId: op.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: record.requestBinding,
    recordJSON,
  };
  fits(reserveArgs);
  const acquired = await t.mutation(reserve, reserveArgs);
  fits(acquired);
  expect(acquired.disposition).toBe("acquired");
  expect(acquired.reservation.recordJSON).toBe(recordJSON);
  expect(acquired.reservation.basisJSON).toBe(
    JSON.stringify(renewalSnapshot(record.basis)),
  );
  const dataNode = objectNode([
    ["event", scalarNode(eventData.event)],
    ["padding", scalarNode(eventData.padding)],
  ]);
  expect(materialize(dataNode)).toEqual(eventData);
  const binding = await eventDigest(
    objectNode([
      ["sequence", scalarNode(1)],
      ["data", dataNode],
    ]),
  );
  expect(binding).toMatch(
    /^unbound-qualification-event:v2:sha256:[0-9a-f]{64}$/,
  );
  const appendArgs = {
    reservation: acquired.reservation,
    expectedSequence: 0,
    event: { sequence: 1, binding, dataJSON },
  };
  fits(appendArgs);
  const receipt = await t.mutation(append, appendArgs);
  fits(receipt);
  expect(receipt.reservation).toEqual(acquired.reservation);
  expect(receipt.sequence).toBe(1);
  expect(receipt.binding).toBe(binding);
  const { reservation: unusedReservation, ...descriptor } = receipt;
  void unusedReservation;
  const expected = { ...descriptor, dataJSON };
  fits(expected);
  const args = {
    operationId: op.operationId,
    attemptId: acquired.reservation.attemptId,
    sequence: 1,
  };
  fits(args);
  // This first case has only small complete documents. Never reuse an aggregate
  // payload snapshot for the later large case: read each large payload by ID.
  async function physical() {
    const rows = await t.run(async (ctx) => ({
      operations: await ctx.db.query("renewalOperations").take(2),
      attempts: await ctx.db.query("renewalOperationAttempts").take(2),
      events: await ctx.db.query("renewalOperationEvents").take(2),
      payloads: await ctx.db.query("renewalOperationPayloads").take(3),
    }));
    fits(rows);
    for (const group of Object.values(rows))
      for (const row of group) expect(getDocumentSize(row) <= limit).toBe(true);
    expect(rows.operations).toHaveLength(1);
    expect(rows.attempts).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
    expect(rows.payloads).toHaveLength(2);
    expect(rows.operations[0]._id).toBe(op.operationId);
    expect(rows.operations[0].state).toBe("RESERVED");
    expect(rows.operations[0].revision).toBe(1);
    expect(rows.operations[0].activeAttemptId).toBe(args.attemptId);
    expect(rows.attempts[0]._id).toBe(args.attemptId);
    expect(rows.attempts[0].lastSequence).toBe(1);
    const { _id, _creationTime, ...fields } = rows.events[0];
    void _creationTime;
    expect({ ...fields, eventId: _id }).toEqual(descriptor);
    const payload = rows.payloads.find((row) => row._id === receipt.payloadId);
    const originalPayload = rows.payloads.find(
      (row) => row._id === acquired.reservation.payloadId,
    );
    expect(payload?.codecVersion).toBe(1);
    expect(payload?.json).toBe(dataJSON);
    expect(originalPayload?.json).toBe(recordJSON);
    return rows;
  }
  const before = await physical();
  let received = false;
  let returnedNull = false;
  try {
    const actual = await t.query(readEvent, args);
    received = true;
    returnedNull = actual === null;
    fits(actual);
    expect(actual).toEqual(expected);
  } finally {
    const after = await physical();
    const unchanged = JSON.stringify(after) === JSON.stringify(before);
    console.info(
      "SCOPED_EVENT_R01",
      JSON.stringify({
        received,
        returnedNull,
        unchanged,
        fetchCalls,
      }),
    );
    expect(unchanged).toBe(true);
    expect(fetchCalls).toBe(0);
  }
});

// Follow-on actual storage tests. R01 above remains byte-for-byte unchanged.
const readManifest = makeFunctionReference<"query">(
  "renewalOperations/queries:readAttempt",
);
function within(value: Parameters<typeof getConvexSize>[0]) {
  expect(getConvexSize(value) <= limit).toBe(true);
}
function fixture() {
  let fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches++;
    throw Error("UNEXPECTED_EXTERNAL_FETCH");
  });
  return { t: convexTest(schema, modules), fetches: () => fetches };
}
type TestClient = ReturnType<typeof fixture>["t"];
async function prepare(t: TestClient, name: string) {
  const data = Object.freeze({
    ...record,
    logicalOperationId: name,
    requestBinding: `storage:${name}`,
  });
  const json = JSON.stringify(renewalSnapshot(data));
  const args = {
    authorizationScope: data.authorization.scope,
    logicalOperationId: name,
    authorizationRevision: data.authorization.revision,
    recordJSON: json,
  };
  within(args);
  const created = await t.mutation(create, args);
  within(created);
  expect(created.status).toBe("created");
  const loadArgs = { operationId: created.operationId };
  within(loadArgs);
  const retained = await t.query(load, loadArgs);
  within(retained);
  expect(retained.recordJSON).toBe(json);
  expect(retained.revision).toBe(0);
  expect(retained.activeAttempt).toBeNull();
  return { operationId: created.operationId, data, json };
}
async function acquire(t: TestClient, name: string) {
  const prepared = await prepare(t, name);
  const args = {
    operationId: prepared.operationId,
    expectedRevision: 0,
    stage: "attach",
    expectedRequestBinding: prepared.data.requestBinding,
    recordJSON: prepared.json,
  };
  within(args);
  const result = await t.mutation(reserve, args);
  within(result);
  expect(result.disposition).toBe("acquired");
  expect(result.reservation.recordJSON).toBe(prepared.json);
  expect(result.reservation.basisJSON).toBe(
    JSON.stringify(renewalSnapshot(record.basis)),
  );
  return { ...prepared, reservation: result.reservation };
}
async function addEvent(
  t: TestClient,
  owned: Awaited<ReturnType<typeof acquire>>,
  sequence: 1 | 2 | 3,
  padding: string,
) {
  const data = Object.freeze({ event: "unqualified-storage-history", padding });
  const json = JSON.stringify(renewalSnapshot(data));
  expect(json.length <= 500000).toBe(true);
  expect(new TextEncoder().encode(json).length <= 500000).toBe(true);
  const node = objectNode([
    ["event", scalarNode(data.event)],
    ["padding", scalarNode(padding)],
  ]);
  expect(materialize(node)).toEqual(data);
  const binding = await eventDigest(
    objectNode([
      ["sequence", scalarNode(sequence)],
      ["data", node],
    ]),
  );
  expect(binding).toMatch(
    /^unbound-qualification-event:v2:sha256:[0-9a-f]{64}$/,
  );
  const args = {
    reservation: owned.reservation,
    expectedSequence: sequence - 1,
    event: { sequence, binding, dataJSON: json },
  };
  within(args);
  const receipt = await t.mutation(append, args);
  within(receipt);
  expect(receipt.reservation).toEqual(owned.reservation);
  expect(receipt.sequence).toBe(sequence);
  expect(receipt.binding).toBe(binding);
  const { reservation: omitted, ...descriptor } = receipt;
  void omitted;
  return { descriptor, full: { ...descriptor, dataJSON: json } };
}
function eventArgs(
  owned: Awaited<ReturnType<typeof acquire>>,
  sequence: number,
) {
  const args = {
    operationId: owned.operationId,
    attemptId: owned.reservation.attemptId,
    sequence,
  };
  within(args);
  return args;
}
async function snapshot(t: TestClient) {
  const operations = await t.run((ctx) =>
    ctx.db.query("renewalOperations").take(4),
  );
  const attempts = await t.run((ctx) =>
    ctx.db.query("renewalOperationAttempts").take(4),
  );
  const events = await t.run((ctx) =>
    ctx.db.query("renewalOperationEvents").take(5),
  );
  const ids = await t.run(async (ctx) =>
    (await ctx.db.query("renewalOperationPayloads").take(7)).map(
      (row) => row._id,
    ),
  );
  for (const reply of [operations, attempts, events, ids]) within(reply);
  const payloads = [];
  for (const id of ids) {
    const row = await t.run((ctx) =>
      ctx.db.get("renewalOperationPayloads", id),
    );
    expect(row).not.toBeNull();
    if (!row) throw Error("SCOPED_HISTORY_PAYLOAD_MISSING");
    within(row);
    payloads.push(row);
  }
  for (const row of [...operations, ...attempts, ...events, ...payloads])
    expect(getDocumentSize(row) <= limit).toBe(true);
  return { operations, attempts, events, payloads };
}
async function readOnly(
  h: ReturnType<typeof fixture>,
  task: (before: Awaited<ReturnType<typeof snapshot>>) => Promise<void>,
) {
  const before = await snapshot(h.t);
  try {
    await task(before);
  } finally {
    const after = await snapshot(h.t);
    expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
    expect(h.fetches()).toBe(0);
  }
}

it("R02 three large events are fully readable through scoped bounded replies", async () => {
  const pads = Object.freeze(
    ["a", "b", "c"].map((char) => char.repeat(380000)),
  );
  const h = fixture();
  const owned = await acquire(h.t, "large-three");
  const events: Awaited<ReturnType<typeof addEvent>>[] = [];
  for (const sequence of [1, 2, 3] as const)
    events.push(await addEvent(h.t, owned, sequence, pads[sequence - 1]));
  const manifestArgs = {
    operationId: owned.operationId,
    attemptId: owned.reservation.attemptId,
  };
  within(manifestArgs);
  expect(
    getConvexSize({
      reservation: owned.reservation,
      events: events.map((event) => event.full),
    }) > limit,
  ).toBe(true);
  await readOnly(h, async (before) => {
    expect(before.operations).toHaveLength(1);
    expect(before.attempts).toHaveLength(1);
    expect(before.events).toHaveLength(3);
    expect(before.payloads).toHaveLength(4);
    expect(before.operations[0].state).toBe("RESERVED");
    expect(before.operations[0].revision).toBe(1);
    expect(before.attempts[0].lastSequence).toBe(3);
    for (const expected of events) {
      const row = before.events.find(
        (r) => r._id === expected.descriptor.eventId,
      );
      expect(row).toBeDefined();
      if (!row) throw Error("SCOPED_HISTORY_EVENT_MISSING");
      const { _id, _creationTime, ...fields } = row;
      void _creationTime;
      expect({ ...fields, eventId: _id }).toEqual(expected.descriptor);
      expect(
        before.payloads.find((p) => p._id === expected.descriptor.payloadId)
          ?.json === expected.full.dataJSON,
      ).toBe(true);
    }
    const manifest = await h.t.query(readManifest, manifestArgs);
    within(manifest);
    expect(manifest.reservation).toEqual(owned.reservation);
    expect(manifest.events).toEqual(events.map((event) => event.descriptor));
    for (const [index, expected] of events.entries()) {
      const actual = await h.t.query(readEvent, eventArgs(owned, index + 1));
      within(actual);
      expect(actual !== null).toBe(true);
      if (!actual) throw Error("SCOPED_EVENT_UNEXPECTED_NULL");
      const { dataJSON: completeJSON, ...descriptor } = actual;
      expect(descriptor).toEqual(expected.descriptor);
      expect(completeJSON === expected.full.dataJSON).toBe(true);
    }
  });
});

it("R03 foreign operation and attempt pairs cannot retrieve another event", async () => {
  const h = fixture();
  const a = await acquire(h.t, "scope-A");
  const b = await acquire(h.t, "scope-B");
  await addEvent(h.t, a, 1, "event-A");
  await addEvent(h.t, b, 1, "event-B");
  await readOnly(h, async () => {
    for (const [op, attempt] of [
      [a, b],
      [b, a],
    ]) {
      const args = {
        ...eventArgs(op, 1),
        attemptId: attempt.reservation.attemptId,
      };
      within(args);
      await expect(h.t.query(readEvent, args)).rejects.toThrow(
        "RENEWAL_JOURNAL_CONFLICT",
      );
    }
  });
});
it("R04 PREPARED operation has no active attempt to read", async () => {
  const h = fixture();
  const a = await acquire(h.t, "active");
  await addEvent(h.t, a, 1, "active-event");
  const p = await prepare(h.t, "prepared-only");
  await readOnly(h, async () => {
    const args = { ...eventArgs(a, 1), operationId: p.operationId };
    within(args);
    await expect(h.t.query(readEvent, args)).rejects.toThrow(
      "RENEWAL_JOURNAL_CONFLICT",
    );
  });
});
it("R05 valid uncommitted sequences return null without losing the event", async () => {
  const h = fixture();
  const a = await acquire(h.t, "missing-sequence");
  const event = await addEvent(h.t, a, 1, "retained-event");
  await readOnly(h, async () => {
    for (const sequence of [2, 3]) {
      const actual = await h.t.query(readEvent, eventArgs(a, sequence));
      within(actual);
      expect(actual).toBeNull();
    }
    const actual = await h.t.query(readEvent, eventArgs(a, 1));
    within(actual);
    expect(actual).toEqual(event.full);
  });
});
it.each([0, 4])(
  "R06 sequence %s is rejected by the registered args validator",
  async (sequence) => {
    const h = fixture();
    const a = await acquire(h.t, "invalid-sequence");
    await addEvent(h.t, a, 1, "validator-prerequisite");
    await readOnly(h, async () => {
      await expect(
        h.t.query(readEvent, eventArgs(a, sequence)),
      ).rejects.toThrow(/^Validator error:/);
    });
  },
);
it("R07 an actual created then deleted operation returns null", async () => {
  const h = fixture();
  const a = await acquire(h.t, "retained-attempt");
  await addEvent(h.t, a, 1, "retained-event");
  const removed = await prepare(h.t, "removed-operation");
  // Explicit damaged-fixture setup, not normal API behavior or a fabricated ID.
  await h.t.run((ctx) =>
    ctx.db.delete("renewalOperations", removed.operationId),
  );
  await readOnly(h, async () => {
    const args = { ...eventArgs(a, 1), operationId: removed.operationId };
    within(args);
    const actual = await h.t.query(readEvent, args);
    within(actual);
    expect(actual).toBeNull();
  });
});
it.each(["gap", "binding", "source"] as const)(
  "R08 %s damage refuses even a missing sequence",
  async (damage) => {
    const h = fixture();
    const a = await acquire(h.t, "corrupt-chain");
    const first = await addEvent(h.t, a, 1, "first");
    await addEvent(h.t, a, 2, "second");
    // Freeze actual damage before readonly oracles. Queries do not cause damage.
    if (damage === "gap") {
      await h.t.run((ctx) =>
        ctx.db.delete("renewalOperationEvents", first.descriptor.eventId),
      );
    } else if (damage === "binding") {
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationEvents", first.descriptor.eventId, {
          binding: "changed-storage-hash",
        }),
      );
    } else {
      const b = await acquire(h.t, "foreign-source");
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationEvents", first.descriptor.eventId, {
          sourcePayloadId: b.reservation.payloadId,
        }),
      );
    }
    await readOnly(h, async (before) => {
      const damaged = before.events.find(
        (row) => row._id === first.descriptor.eventId,
      );
      if (damage === "gap") expect(damaged).toBeUndefined();
      else expect(damaged).toBeDefined();
      if (damage === "binding")
        expect(damaged?.binding).toBe("changed-storage-hash");
      if (damage === "source")
        expect(damaged?.sourcePayloadId !== a.reservation.payloadId).toBe(true);
      for (const sequence of [2, 3])
        await expect(
          h.t.query(readEvent, eventArgs(a, sequence)),
        ).rejects.toThrow("RENEWAL_JOURNAL_CONFLICT");
    });
  },
);

it("R06b closed query args reject an arbitrary payload ID selector", async () => {
  const h = fixture();
  const a = await acquire(h.t, "no-payload-selector");
  const event = await addEvent(h.t, a, 1, "retained-event");
  await readOnly(h, async () => {
    const args = { ...eventArgs(a, 1), payloadId: event.descriptor.payloadId };
    within(args);
    await expect(h.t.query(readEvent, args)).rejects.toThrow(
      /^Validator error:/,
    );
  });
});

it("R09 identical foreign payload cannot replace the scoped event payload", async () => {
  const h = fixture();
  const a = await acquire(h.t, "payload-owner-A");
  const b = await acquire(h.t, "payload-owner-B");
  const first = await addEvent(h.t, a, 1, "same-complete-DATA");
  const second = await addEvent(h.t, b, 1, "same-complete-DATA");
  expect(a.operationId).not.toBe(b.operationId);
  expect(a.reservation.attemptId).not.toBe(b.reservation.attemptId);
  expect(first.descriptor.payloadId).not.toBe(second.descriptor.payloadId);
  expect(first.full.dataJSON).toBe(second.full.dataJSON);
  expect(first.descriptor.binding).toBe(second.descriptor.binding);
  // Explicit fixture corruption changes only the A event's payload pointer.
  await h.t.run((ctx) =>
    ctx.db.patch("renewalOperationEvents", first.descriptor.eventId, {
      payloadId: second.descriptor.payloadId,
    }),
  );
  await readOnly(h, async (before) => {
    const { eventId, ...originalFields } = first.descriptor;
    expect(before.events.find((row) => row._id === eventId)).toMatchObject({
      ...originalFields,
      _id: eventId,
      payloadId: second.descriptor.payloadId,
    });
    expect(
      before.payloads.find((row) => row._id === second.descriptor.payloadId)
        ?.json,
    ).toBe(second.full.dataJSON);
    await expect(h.t.query(readEvent, eventArgs(a, 1))).rejects.toThrow(
      "RENEWAL_JOURNAL_CONFLICT",
    );
  });
});
