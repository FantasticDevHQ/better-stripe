import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalJournalRecord,
  canonicalJournalEvent,
} from "../../shared/renewalOperationJournal.js";
import {
  canonical,
  codecFixture,
  componentFixture,
  create,
  load,
  VALUE_LIMIT,
} from "./timingPolicy.fixtures.js";

const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
afterEach(() => vi.unstubAllGlobals());

it("RESERVE01 commits policy-only V2 first-CAS DATA without a live basis", async () => {
  // The maintained fixture declares its complete raw source/policy before C1/C2.
  // All preparation and journal values here are unsigned DATA, not capabilities.
  const h = await codecFixture();
  const { t, physical } = componentFixture();
  const createArgs = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(createArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const created = await t.mutation(create, createArgs);
  expect(created.status).toBe("created");
  expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
  const queryArgs = { operationId: created.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const prepared = await t.query(load, queryArgs);
  expect(prepared).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 0,
    activeAttempt: null,
    initialBasis: null,
  });
  expect(getConvexSize(prepared)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.payloads).toHaveLength(1);
  expect(before.attempts).toHaveLength(0);
  expect(before.events).toHaveLength(0);
  const operation = before.operations[0];
  const payload = before.payloads[0];
  expect(operation).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    payloadId: payload._id,
    requestBinding: h.record.requestBinding,
    revision: 0,
    state: "PREPARED",
  });
  expect(payload).toMatchObject({
    codecVersion: 1,
    json: h.recordJSON,
    owner: { kind: "operation", operationId: created.operationId },
  });
  expect(Object.prototype.hasOwnProperty.call(operation, "initialBasis")).toBe(
    false,
  );
  for (const rows of Object.values(before)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  const args = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.record.requestBinding,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  let stable = JSON.stringify(before);
  let targetFailed = false;
  try {
    // Actual existing route, currently fenced: this is the first desired behavior.
    const acquired = await t.mutation(reserve, args);
    expect(acquired.disposition).toBe("acquired");
    expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
    const summary = {
      recordVersion: 2,
      operationId: created.operationId,
      payloadId: payload._id,
      authorizationScope: h.record.authorization.scope,
      authorizationId: h.record.authorization.id,
      authorizationRevision: h.record.authorization.revision,
      logicalOperationId: h.record.logicalOperationId,
      requestBinding: h.record.requestBinding,
      stage: "attach",
      key: h.request.key,
      apiVersion: h.request.apiVersion,
      accountJSON: canonical(h.record.account),
      timingPolicyJSON: canonical(h.record.timingPolicy),
      firstDispatchedAt: h.request.firstDispatchedAt,
      ordinal: 1,
      preparedRevision: 0,
      committedRevision: 1,
      attemptId: acquired.reservation.attemptId,
    };
    expect(acquired).toEqual({
      disposition: "acquired",
      previousRevision: 0,
      committedRevision: 1,
      reservation: { ...summary, recordJSON: h.recordJSON },
    });
    expect(
      Object.prototype.hasOwnProperty.call(acquired.reservation, "basisJSON"),
    ).toBe(false);
    const stored = await physical();
    stable = JSON.stringify(stored);
    expect(stored.operations).toHaveLength(1);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.payloads).toEqual(before.payloads);
    expect(stored.events).toHaveLength(0);
    expect(stored.operations[0]).toEqual({
      ...operation,
      revision: 1,
      state: "RESERVED",
      activeAttemptId: summary.attemptId,
    });
    const { attemptId, ...fields } = summary;
    expect(stored.attempts[0]).toEqual({
      ...fields,
      _id: attemptId,
      _creationTime: stored.attempts[0]._creationTime,
      lastSequence: 0,
    });
    for (const rows of Object.values(stored)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const loaded = await t.query(load, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({
      recordVersion: 2,
      operationId: created.operationId,
      recordJSON: h.recordJSON,
      revision: 1,
      activeAttempt: summary,
      initialBasis: null,
    });
    expect(canonical(h.record)).toBe(h.recordJSON);
  } catch (error) {
    targetFailed = true;
    console.info(
      "RESERVE01_TARGET_ERROR",
      error instanceof Error ? error.message : "NON_ERROR_THROW",
    );
    throw error;
  } finally {
    try {
      const after = await physical();
      console.info(
        "RESERVE01_SETTLEMENT",
        JSON.stringify({
          physicalEqual: JSON.stringify(after) === stable,
          rows: Object.fromEntries(
            Object.entries(after).map(([key, rows]) => [key, rows.length]),
          ),
          fetchCalls: h.fetchCalls(),
        }),
      );
      expect(JSON.stringify(after)).toBe(stable);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("RESERVE01_READONLY_INSPECTION_FAILED");
    }
  }
});

const changedWorkEndWallMs = 1700000005001;

async function preparedOperation() {
  const h = await codecFixture();
  const { t, physical } = componentFixture();
  const createArgs = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(createArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const created = await t.mutation(create, createArgs);
  expect(created.status).toBe("created");
  expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
  const queryArgs = { operationId: created.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const loaded = await t.query(load, queryArgs);
  expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(loaded).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 0,
    activeAttempt: null,
    initialBasis: null,
  });
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.payloads).toHaveLength(1);
  expect(before.attempts).toHaveLength(0);
  expect(before.events).toHaveLength(0);
  expect(before.operations[0]).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    payloadId: before.payloads[0]._id,
    revision: 0,
    state: "PREPARED",
  });
  expect(before.payloads[0]).toMatchObject({
    json: h.recordJSON,
    codecVersion: 1,
    owner: { kind: "operation", operationId: created.operationId },
  });
  const args = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.record.requestBinding,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  for (const rows of Object.values(before)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  return { h, t, physical, before, args };
}

it("RESERVE02 concurrently commits one acquired and one identical existing V2 DATA reservation", async () => {
  const { h, t, physical, before, args } = await preparedOperation();
  let stable = JSON.stringify(before);
  let targetFailed = false;
  try {
    const settled = await Promise.allSettled([
      t.mutation(reserve, args),
      t.mutation(reserve, args),
    ]);
    const replies = settled.map((reply) => {
      if (reply.status !== "fulfilled") throw reply.reason;
      return reply.value;
    });
    expect(settled.map((reply) => reply.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      replies.filter((reply) => reply.disposition === "acquired"),
    ).toHaveLength(1);
    expect(
      replies.filter((reply) => reply.disposition === "existing"),
    ).toHaveLength(1);
    const acquired = replies.find((reply) => reply.disposition === "acquired");
    const existing = replies.find((reply) => reply.disposition === "existing");
    expect(acquired).toBeDefined();
    expect(existing).toBeDefined();
    if (!acquired || !existing) throw Error("RESERVE02_MISSING_REPLY");
    const expected = {
      recordVersion: 2,
      operationId: args.operationId,
      payloadId: before.payloads[0]._id,
      authorizationScope: h.record.authorization.scope,
      authorizationId: h.record.authorization.id,
      authorizationRevision: h.record.authorization.revision,
      logicalOperationId: h.record.logicalOperationId,
      requestBinding: h.record.requestBinding,
      stage: "attach",
      key: h.request.key,
      apiVersion: h.request.apiVersion,
      accountJSON: canonical(h.record.account),
      timingPolicyJSON: canonical(h.record.timingPolicy),
      firstDispatchedAt: h.request.firstDispatchedAt,
      ordinal: 1,
      preparedRevision: 0,
      committedRevision: 1,
      attemptId: acquired.reservation.attemptId,
      recordJSON: h.recordJSON,
    };
    expect(acquired).toEqual({
      disposition: "acquired",
      previousRevision: 0,
      committedRevision: 1,
      reservation: expected,
    });
    expect(existing).toEqual({
      disposition: "existing",
      committedRevision: 1,
      reservation: expected,
    });
    for (const reply of replies)
      expect(getConvexSize(reply)).toBeLessThanOrEqual(VALUE_LIMIT);
    const stored = await physical();
    stable = JSON.stringify(stored);
    expect(stored.operations).toHaveLength(1);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.payloads).toEqual(before.payloads);
    expect(stored.events).toHaveLength(0);
    expect(stored.operations[0]).toEqual({
      ...before.operations[0],
      revision: 1,
      state: "RESERVED",
      activeAttemptId: expected.attemptId,
    });
    const { recordJSON: _recordJSON, attemptId, ...fields } = expected;
    void _recordJSON;
    expect(stored.attempts[0]).toEqual({
      ...fields,
      _id: attemptId,
      _creationTime: stored.attempts[0]._creationTime,
      lastSequence: 0,
    });
    for (const rows of Object.values(stored)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const replay = await t.mutation(reserve, args);
    expect(replay).toEqual(existing);
    expect(getConvexSize(replay)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(JSON.stringify(await physical())).toBe(stable);
    // Exact row equality above excludes a persisted acquired/disposition flag.
    expect(canonical(h.record)).toBe(h.recordJSON);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(JSON.stringify(await physical())).toBe(stable);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("RESERVE02_READONLY_INSPECTION_FAILED");
    }
  }
});

it("RESERVE03 refuses a changed complete timing policy without changing PREPARED DATA", async () => {
  const { h, t, physical, before, args } = await preparedOperation();
  const changed = {
    ...h.record,
    timingPolicy: {
      ...h.record.timingPolicy,
      workEndWallMs: changedWorkEndWallMs,
    },
  };
  const recordJSON = canonical(changed);
  expect(recordJSON).not.toBe(h.recordJSON);
  expect(recordJSON.length).toBeLessThanOrEqual(500000);
  expect(new TextEncoder().encode(recordJSON).length).toBeLessThanOrEqual(
    500000,
  );
  expect(canonicalJournalRecord(recordJSON)).toMatchObject({
    recordVersion: 2,
    json: recordJSON,
  });
  const changedArgs = { ...args, recordJSON };
  expect(getConvexSize(changedArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  let targetFailed = false;
  try {
    const refused = await t.mutation(reserve, changedArgs);
    expect(getConvexSize(refused)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(refused).toEqual({
      disposition: "conflict",
      reason: "identity_changed",
    });
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("RESERVE03_READONLY_INSPECTION_FAILED");
    }
  }
});

const append = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:appendStageEvent",
);

it("UNBOUND01 refuses an actual complete event1 append before basis binding", async () => {
  const { h, t, physical, args } = await preparedOperation();
  const acquired = await t.mutation(reserve, args);
  expect(acquired.disposition).toBe("acquired");
  expect(acquired.reservation).toMatchObject({
    recordVersion: 2,
    recordJSON: h.recordJSON,
  });
  expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
  const { recordJSON, ...summary } = acquired.reservation;
  expect(recordJSON).toBe(h.recordJSON);
  const clean = await t.query(load, { operationId: args.operationId });
  expect(getConvexSize(clean)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(clean).toEqual({
    recordVersion: 2,
    operationId: args.operationId,
    recordJSON: h.recordJSON,
    revision: 1,
    activeAttempt: summary,
    initialBasis: null,
  });
  // Canonical unsigned dispatch DATA; no actual typed C10/Owner claim.
  const datum = { event: "dispatch", stage: "attach", request: h.request };
  const event = await canonicalJournalEvent(1, canonical(datum));
  expect(JSON.parse(event.json)).toEqual(datum);
  const appendArgs = {
    reservation: acquired.reservation,
    expectedSequence: 0,
    event: {
      sequence: event.sequence,
      binding: event.binding,
      dataJSON: event.json,
    },
  };
  expect(getConvexSize(appendArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toHaveLength(1);
  expect(before.payloads).toHaveLength(1);
  expect(before.events).toHaveLength(0);
  expect(before.attempts[0].lastSequence).toBe(0);
  expect(
    Object.prototype.hasOwnProperty.call(before.operations[0], "initialBasis"),
  ).toBe(false);
  for (const rows of Object.values(before)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  let targetFailed = false;
  try {
    await expect(t.mutation(append, appendArgs)).rejects.toThrow(
      /^RENEWAL_JOURNAL_CONFLICT$/,
    );
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("UNBOUND01_READONLY_INSPECTION_FAILED");
    }
  }
});

it("UNBOUND02 refuses an actual event row hidden behind a zero sequence counter", async () => {
  const { h, t, physical, args } = await preparedOperation();
  const acquired = await t.mutation(reserve, args);
  expect(acquired.disposition).toBe("acquired");
  expect(acquired.reservation).toMatchObject({
    recordVersion: 2,
    recordJSON: h.recordJSON,
  });
  expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
  const { recordJSON, ...summary } = acquired.reservation;
  expect(recordJSON).toBe(h.recordJSON);
  const clean = await t.query(load, { operationId: args.operationId });
  expect(getConvexSize(clean)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(clean).toEqual({
    recordVersion: 2,
    operationId: args.operationId,
    recordJSON: h.recordJSON,
    revision: 1,
    activeAttempt: summary,
    initialBasis: null,
  });
  const event = await canonicalJournalEvent(
    1,
    canonical({ event: "dispatch", stage: "attach", request: h.request }),
  );
  const intact = await physical();
  expect(intact.operations).toHaveLength(1);
  expect(intact.attempts).toHaveLength(1);
  expect(intact.attempts[0].lastSequence).toBe(0);
  expect(intact.events).toHaveLength(0);
  expect(intact.payloads).toHaveLength(1);
  // Deliberate physical corruption using actual returned IDs and canonical DATA.
  // The attempt counter deliberately stays zero; no receipt/basis is fabricated.
  const injected = await t.run(async (ctx) => {
    const payloadId = await ctx.db.insert("renewalOperationPayloads", {
      codecVersion: 1,
      json: event.json,
      owner: {
        kind: "event",
        operationId: args.operationId,
        attemptId: acquired.reservation.attemptId,
        stage: "attach",
        sequence: 1,
      },
    });
    const eventId = await ctx.db.insert("renewalOperationEvents", {
      operationId: args.operationId,
      attemptId: acquired.reservation.attemptId,
      stage: "attach",
      sourcePayloadId: acquired.reservation.payloadId,
      sequence: 1,
      binding: event.binding,
      payloadId,
    });
    return { payloadId, eventId };
  });
  const before = await physical();
  expect(before.operations).toEqual(intact.operations);
  expect(before.attempts).toEqual(intact.attempts);
  expect(before.payloads).toHaveLength(2);
  expect(before.events).toHaveLength(1);
  expect(
    before.payloads.find((row) => row._id === intact.payloads[0]._id),
  ).toEqual(intact.payloads[0]);
  expect(
    before.payloads.find((row) => row._id === injected.payloadId),
  ).toMatchObject({
    json: event.json,
    codecVersion: 1,
    owner: {
      kind: "event",
      operationId: args.operationId,
      attemptId: acquired.reservation.attemptId,
      stage: "attach",
      sequence: 1,
    },
  });
  expect(before.events[0]).toMatchObject({
    _id: injected.eventId,
    operationId: args.operationId,
    attemptId: acquired.reservation.attemptId,
    stage: "attach",
    sourcePayloadId: acquired.reservation.payloadId,
    sequence: 1,
    binding: event.binding,
    payloadId: injected.payloadId,
  });
  for (const rows of Object.values(before)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  const queryArgs = { operationId: args.operationId };
  expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  let targetFailed = false;
  try {
    await expect(t.query(load, queryArgs)).rejects.toThrow(
      /^RENEWAL_JOURNAL_CONFLICT$/,
    );
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("UNBOUND02_READONLY_INSPECTION_FAILED");
    }
  }
});
