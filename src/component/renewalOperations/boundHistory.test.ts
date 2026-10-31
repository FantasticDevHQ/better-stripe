import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
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
const bind = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:bindInitialBasis",
);
const append = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:appendStageEvent",
);
const manifest = makeFunctionReference<"query">(
  "renewalOperations/queries:readAttempt",
);
const readEvent = makeFunctionReference<"query">(
  "renewalOperations/queries:readStageEvent",
);
const readACK = makeFunctionReference<"query">(
  "renewalOperations/queries:readProviderAcknowledgement",
);
// Unsigned fixed DATA, not a live clock, Origin, Owner or provider receipt.
const basis = Object.freeze({
  startWallMs: 1700000001000,
  startNsDecimal: "1000000000",
  workEndWallMs: 1700000005000,
  workEndNsDecimal: "5000000000",
  endWallMs: 1700000006000,
  endNsDecimal: "6000000000",
});
const corruptions = [
  "owner-stage",
  "event-binding",
  "counter",
  "counter-zero",
  "missing-basis",
] as const;
afterEach(() => vi.unstubAllGlobals());

async function boundOperation() {
  const h = await codecFixture();
  const { t, physical } = componentFixture();
  expect(BigInt(basis.workEndNsDecimal)).toBe(
    BigInt(basis.startNsDecimal) + 4000000000n,
  );
  expect(BigInt(basis.endNsDecimal)).toBe(
    BigInt(basis.startNsDecimal) + 5000000000n,
  );
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
  expect(await t.query(load, queryArgs)).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 0,
    activeAttempt: null,
    initialBasis: null,
  });
  const reserveArgs = {
    operationId: created.operationId,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.record.requestBinding,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(reserveArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const acquired = await t.mutation(reserve, reserveArgs);
  expect(acquired.disposition).toBe("acquired");
  expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toHaveLength(1);
  expect(before.payloads).toHaveLength(1);
  expect(before.events).toHaveLength(0);
  const operation = before.operations[0];
  const attempt = before.attempts[0];
  const payload = before.payloads[0];
  expect(operation).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    payloadId: payload._id,
    requestBinding: h.record.requestBinding,
    revision: 1,
    state: "RESERVED",
    activeAttemptId: attempt._id,
  });
  expect(payload).toMatchObject({
    codecVersion: 1,
    json: h.recordJSON,
    owner: { kind: "operation", operationId: created.operationId },
  });
  expect(Object.prototype.hasOwnProperty.call(operation, "initialBasis")).toBe(
    false,
  );
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
    attemptId: attempt._id,
  };
  expect(acquired).toEqual({
    disposition: "acquired",
    previousRevision: 0,
    committedRevision: 1,
    reservation: { ...summary, recordJSON: h.recordJSON },
  });
  const { attemptId, ...fields } = summary;
  expect(attempt).toEqual({
    ...fields,
    _id: attemptId,
    _creationTime: attempt._creationTime,
    lastSequence: 0,
  });
  const reserved = await t.query(load, queryArgs);
  expect(reserved).toEqual({
    recordVersion: 2,
    operationId: created.operationId,
    recordJSON: h.recordJSON,
    revision: 1,
    activeAttempt: summary,
    initialBasis: null,
  });
  expect(getConvexSize(reserved)).toBeLessThanOrEqual(VALUE_LIMIT);
  const args = {
    operationId: created.operationId,
    attemptId: attempt._id,
    policyJSON: canonical(h.record.timingPolicy),
    basisJSON: canonical(basis),
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const initialBasis = {
    version: 1 as const,
    attemptId: attempt._id,
    sourcePayloadId: payload._id,
    stage: "attach" as const,
    policyJSON: args.policyJSON,
    basisJSON: args.basisJSON,
  };
  const receipt = {
    status: "bound",
    operationId: created.operationId,
    initialBasis,
  };
  const result = await t.mutation(bind, args);
  expect(result).toEqual(receipt);
  expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
  const boundRows = await physical();
  expect(boundRows).toEqual({
    ...before,
    operations: [{ ...operation, initialBasis }],
  });
  for (const rows of Object.values(boundRows)) {
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  const loaded = await t.query(load, queryArgs);
  expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(loaded).toEqual({ ...reserved, initialBasis });
  expect(h.fetchCalls()).toBe(0);
  return {
    fixture: h,
    t,
    physical,
    args,
    queryArgs,
    initialBasis,
    receipt,
    boundRows,
    reservation: acquired.reservation,
    loaded,
  };
}

async function historyFixture() {
  const h = await boundOperation();
  const datum = {
    event: "dispatch",
    stage: "attach",
    request: h.fixture.request,
  };
  const event = await canonicalJournalEvent(1, canonical(datum));
  expect(JSON.parse(event.json)).toEqual(datum);
  const appendArgs = {
    reservation: h.reservation,
    expectedSequence: 0,
    event: { sequence: 1, binding: event.binding, dataJSON: event.json },
  };
  expect(getConvexSize(appendArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const appended = await h.t.mutation(append, appendArgs);
  expect(getConvexSize(appended)).toBeLessThanOrEqual(VALUE_LIMIT);
  const descriptor = {
    operationId: h.args.operationId,
    attemptId: h.args.attemptId,
    stage: "attach",
    sourcePayloadId: h.reservation.payloadId,
    sequence: 1,
    binding: event.binding,
    payloadId: appended.payloadId,
    eventId: appended.eventId,
  };
  expect(appended).toEqual({ ...descriptor, reservation: h.reservation });
  const rows = await h.physical();
  expect(rows.operations).toEqual(h.boundRows.operations);
  expect(rows.attempts).toEqual([
    { ...h.boundRows.attempts[0], lastSequence: 1 },
  ]);
  expect(rows.payloads).toHaveLength(2);
  expect(rows.events).toHaveLength(1);
  expect(
    rows.payloads.find((row) => row._id === h.reservation.payloadId),
  ).toEqual(h.boundRows.payloads[0]);
  const payload = rows.payloads.find((row) => row._id === appended.payloadId);
  expect(payload).toBeDefined();
  if (!payload) throw Error("BOUND_HISTORY_MISSING_REAL_PAYLOAD");
  expect(payload).toEqual({
    _id: appended.payloadId,
    _creationTime: payload._creationTime,
    codecVersion: 1,
    json: event.json,
    owner: {
      kind: "event",
      operationId: h.args.operationId,
      attemptId: h.args.attemptId,
      stage: "attach",
      sequence: 1,
    },
  });
  const owner = payload.owner;
  if (!owner || owner.kind !== "event")
    throw Error("BOUND_HISTORY_WRONG_OWNER");
  expect(rows.events[0]).toEqual({
    _id: appended.eventId,
    _creationTime: rows.events[0]._creationTime,
    operationId: descriptor.operationId,
    attemptId: descriptor.attemptId,
    stage: descriptor.stage,
    sourcePayloadId: descriptor.sourcePayloadId,
    sequence: 1,
    binding: event.binding,
    payloadId: descriptor.payloadId,
  });
  for (const group of Object.values(rows)) {
    for (const row of group)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  }
  const loaded = await h.t.query(load, h.queryArgs);
  expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(loaded).toEqual(h.loaded);
  const reserveArgs = {
    operationId: h.args.operationId,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.fixture.record.requestBinding,
    recordJSON: h.fixture.recordJSON,
  };
  const createArgs = {
    authorizationScope: h.fixture.record.authorization.scope,
    logicalOperationId: h.fixture.record.logicalOperationId,
    authorizationRevision: h.fixture.record.authorization.revision,
    recordJSON: h.fixture.recordJSON,
  };
  const historyArgs = {
    operationId: h.args.operationId,
    attemptId: h.args.attemptId,
  };
  for (const args of [reserveArgs, createArgs, historyArgs])
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  for (const sequence of [1, 2]) {
    expect(getConvexSize({ ...historyArgs, sequence })).toBeLessThanOrEqual(
      VALUE_LIMIT,
    );
  }
  expect(await h.physical()).toEqual(rows);
  expect(h.fixture.fetchCalls()).toBe(0);
  return {
    ...h,
    event,
    appendArgs,
    appended,
    descriptor,
    rows,
    owner,
    reserveArgs,
    createArgs,
    historyArgs,
  };
}

it("BOUNDH01 reads full event DATA and preserves every stable duplicate response", async () => {
  const h = await historyFixture();
  let targetFailed = false;
  try {
    const results = await Promise.allSettled([
      h.t.mutation(append, h.appendArgs),
      h.t.query(manifest, h.historyArgs),
      h.t.query(readEvent, { ...h.historyArgs, sequence: 1 }),
      h.t.query(readEvent, { ...h.historyArgs, sequence: 2 }),
      h.t.query(readACK, h.queryArgs),
      h.t.query(load, h.queryArgs),
      h.t.mutation(reserve, h.reserveArgs),
      h.t.mutation(bind, h.args),
      h.t.mutation(create, h.createArgs),
    ]);
    const values = results.map((result) => {
      if (result.status !== "fulfilled") throw result.reason;
      expect(getConvexSize(result.value)).toBeLessThanOrEqual(VALUE_LIMIT);
      return result.value;
    });
    expect(values).toEqual([
      h.appended,
      { reservation: h.reservation, events: [h.descriptor] },
      { ...h.descriptor, dataJSON: h.event.json },
      null,
      null,
      h.loaded,
      {
        disposition: "existing",
        committedRevision: 1,
        reservation: h.reservation,
      },
      h.receipt,
      { status: "existing", operationId: h.args.operationId },
    ]);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await h.physical()).toEqual(h.rows);
      expect(h.fixture.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("BOUNDH01_READONLY_INSPECTION_FAILED");
    }
  }
});

it.each(corruptions)(
  "BOUNDH02 refuses %s corruption through all eight APIs without repair",
  async (kind) => {
    const h = await historyFixture();
    let expected = h.rows;
    if (kind === "owner-stage") {
      const owner = { ...h.owner, stage: "configure" as const };
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", h.descriptor.payloadId, {
          owner,
        }),
      );
      expected = {
        ...expected,
        payloads: expected.payloads.map((row) =>
          row._id === h.descriptor.payloadId ? { ...row, owner } : row,
        ),
      };
    } else if (kind === "event-binding") {
      const binding =
        h.event.binding.slice(0, -1) +
        (h.event.binding.endsWith("0") ? "1" : "0");
      expect(binding).not.toBe(h.event.binding);
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationEvents", h.descriptor.eventId, {
          binding,
        }),
      );
      expected = { ...expected, events: [{ ...expected.events[0], binding }] };
    } else if (kind === "counter" || kind === "counter-zero") {
      const lastSequence = kind === "counter" ? 2 : 0;
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationAttempts", h.args.attemptId, {
          lastSequence,
        }),
      );
      expected = {
        ...expected,
        attempts: [{ ...expected.attempts[0], lastSequence }],
      };
    } else if (kind === "missing-basis") {
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperations", h.args.operationId, {
          initialBasis: undefined,
        }),
      );
      const { initialBasis: _basis, ...operation } = expected.operations[0];
      void _basis;
      expected = { ...expected, operations: [operation] };
    }
    const damaged = await h.physical();
    expect(damaged).toEqual(expected);
    for (const group of Object.values(damaged)) {
      for (const row of group)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    let targetFailed = false;
    try {
      const settled = await Promise.allSettled([
        h.t.query(load, h.queryArgs),
        h.t.query(manifest, h.historyArgs),
        h.t.query(readEvent, { ...h.historyArgs, sequence: 2 }),
        h.t.query(readACK, h.queryArgs),
        h.t.mutation(reserve, h.reserveArgs),
        h.t.mutation(bind, h.args),
        h.t.mutation(create, h.createArgs),
        h.t.mutation(append, h.appendArgs),
      ]);
      console.info(
        "BOUNDH02_SETTLEMENT",
        JSON.stringify({
          kind,
          statuses: settled.map((result) => result.status),
        }),
      );
      expect(settled).toEqual(
        Array.from({ length: 8 }, () => ({
          status: "rejected",
          reason: expect.objectContaining({
            message: "RENEWAL_JOURNAL_CONFLICT",
          }),
        })),
      );
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(await h.physical()).toEqual(damaged);
        expect(h.fixture.fetchCalls()).toBe(0);
      } catch (inspectionError) {
        if (!targetFailed) throw inspectionError;
        console.info("BOUNDH02_READONLY_INSPECTION_FAILED");
      }
    }
  },
);
