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
// Fixed unsigned DATA, never an actual sampled clock/Owner or eligibility claim.
const basis = Object.freeze({
  startWallMs: 1700000001000,
  startNsDecimal: "1000000000",
  workEndWallMs: 1700000005000,
  workEndNsDecimal: "5000000000",
  endWallMs: 1700000006000,
  endNsDecimal: "6000000000",
});
const changedAnchor = Object.freeze({
  ...basis,
  startNsDecimal: "1000000001",
  workEndNsDecimal: "5000000001",
  endNsDecimal: "6000000001",
});
const corruptBasis = Object.freeze({
  ...basis,
  workEndNsDecimal: "5000000001",
});
const legacyBasis = Object.freeze({
  startWallMs: basis.startWallMs,
  startNs: basis.startNsDecimal,
  workEndWallMs: basis.workEndWallMs,
  workEndNs: basis.workEndNsDecimal,
  endWallMs: basis.endWallMs,
  endNs: basis.endNsDecimal,
});
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

it("BASISL01 returns the original canonical receipt for reordered duplicate DATA", async () => {
  const h = await boundOperation();
  const policyJSON = JSON.stringify(
    Object.fromEntries(Object.entries(JSON.parse(h.args.policyJSON)).reverse()),
    null,
    2,
  );
  const basisJSON = JSON.stringify(
    Object.fromEntries(Object.entries(JSON.parse(h.args.basisJSON)).reverse()),
    null,
    2,
  );
  expect(policyJSON).not.toBe(h.args.policyJSON);
  expect(basisJSON).not.toBe(h.args.basisJSON);
  expect(canonical(JSON.parse(policyJSON))).toBe(h.args.policyJSON);
  expect(canonical(JSON.parse(basisJSON))).toBe(h.args.basisJSON);
  const args = { ...h.args, policyJSON, basisJSON };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  let targetFailed = false;
  try {
    const duplicate = await h.t.mutation(bind, args);
    expect(getConvexSize(duplicate)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(duplicate).toEqual(h.receipt);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await h.physical()).toEqual(h.boundRows);
      expect(h.fixture.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("BASISL01_READONLY_INSPECTION_FAILED");
    }
  }
});

it("BASISL02 refuses a different mathematically valid anchor without rebinding", async () => {
  expect(BigInt(changedAnchor.workEndNsDecimal)).toBe(
    BigInt(changedAnchor.startNsDecimal) +
      BigInt(changedAnchor.workEndWallMs - changedAnchor.startWallMs) *
        1000000n,
  );
  expect(BigInt(changedAnchor.endNsDecimal)).toBe(
    BigInt(changedAnchor.startNsDecimal) +
      BigInt(changedAnchor.endWallMs - changedAnchor.startWallMs) * 1000000n,
  );
  const h = await boundOperation();
  const args = { ...h.args, basisJSON: canonical(changedAnchor) };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  let targetFailed = false;
  try {
    await expect(h.t.mutation(bind, args)).rejects.toThrow(
      /^RENEWAL_JOURNAL_CONFLICT$/,
    );
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await h.physical()).toEqual(h.boundRows);
      expect(h.fixture.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("BASISL02_READONLY_INSPECTION_FAILED");
    }
  }
});

it("BASISL03 refuses corrupted stored projection through load and duplicate bind", async () => {
  const h = await boundOperation();
  const corrupt = { ...h.initialBasis, basisJSON: canonical(corruptBasis) };
  await h.t.run((ctx) =>
    ctx.db.patch("renewalOperations", h.args.operationId, {
      initialBasis: corrupt,
    }),
  );
  const damaged = await h.physical();
  expect(damaged).toEqual({
    ...h.boundRows,
    operations: [{ ...h.boundRows.operations[0], initialBasis: corrupt }],
  });
  let targetFailed = false;
  try {
    const settled = await Promise.allSettled([
      h.t.query(load, h.queryArgs),
      h.t.mutation(bind, h.args),
    ]);
    expect(settled).toEqual([
      {
        status: "rejected",
        reason: expect.objectContaining({
          message: "RENEWAL_JOURNAL_CONFLICT",
        }),
      },
      {
        status: "rejected",
        reason: expect.objectContaining({
          message: "RENEWAL_JOURNAL_CONFLICT",
        }),
      },
    ]);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await h.physical()).toEqual(damaged);
      expect(h.fixture.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("BASISL03_READONLY_INSPECTION_FAILED");
    }
  }
});

it.each(["v2-prepared", "v1-prepared"] as const)(
  "BASISL04 refuses a foreign descriptor on %s DATA",
  async (kind) => {
    const h = await boundOperation();
    const candidate: Record<string, unknown> = {
      ...h.fixture.record,
      logicalOperationId: "basis-lifecycle-B",
      authorization: {
        ...h.fixture.record.authorization,
        id: "basis-lifecycle-consent-B",
      },
    };
    if (kind === "v1-prepared") {
      candidate.schemaVersion = 1;
      candidate.basis = legacyBasis;
      delete candidate.timingPolicy;
    }
    const recordJSON = canonical(candidate);
    const args = {
      authorizationScope: h.fixture.record.authorization.scope,
      logicalOperationId: "basis-lifecycle-B",
      authorizationRevision: 1,
      recordJSON,
    };
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    const created = await h.t.mutation(create, args);
    expect(created.status).toBe("created");
    expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
    const queryArgs = { operationId: created.operationId };
    expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const clean = await h.t.query(load, queryArgs);
    expect(getConvexSize(clean)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(clean).toEqual({
      ...(kind === "v2-prepared"
        ? { recordVersion: 2, initialBasis: null }
        : {}),
      operationId: created.operationId,
      recordJSON,
      revision: 0,
      activeAttempt: null,
    });
    const before = await h.physical();
    expect(before.operations).toHaveLength(2);
    expect(before.attempts).toHaveLength(1);
    expect(before.payloads).toHaveLength(2);
    expect(before.events).toHaveLength(0);
    const operationB = before.operations.find(
      (row) => row._id === created.operationId,
    );
    expect(operationB).toMatchObject({
      _id: created.operationId,
      revision: 0,
      state: "PREPARED",
    });
    if (!operationB) throw Error("BASISL04_MISSING_REAL_OPERATION");
    expect(
      before.payloads.find((row) => row._id === operationB.payloadId),
    ).toMatchObject({
      codecVersion: 1,
      json: recordJSON,
      owner: { kind: "operation", operationId: created.operationId },
    });
    const foreign = h.initialBasis;
    expect(foreign.sourcePayloadId).not.toBe(operationB.payloadId);
    await h.t.run((ctx) =>
      ctx.db.patch("renewalOperations", created.operationId, {
        initialBasis: foreign,
      }),
    );
    const damaged = await h.physical();
    expect(damaged).toEqual({
      ...before,
      operations: before.operations.map((row) =>
        row._id === created.operationId
          ? { ...row, initialBasis: foreign }
          : row,
      ),
    });
    for (const rows of Object.values(damaged)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const foreignArgs = { ...h.args, operationId: created.operationId };
    expect(getConvexSize(foreignArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    let targetFailed = false;
    try {
      const settled = await Promise.allSettled([
        h.t.query(load, queryArgs),
        h.t.mutation(bind, foreignArgs),
      ]);
      expect(settled).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: "RENEWAL_JOURNAL_CONFLICT",
          }),
        },
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: "RENEWAL_JOURNAL_CONFLICT",
          }),
        },
      ]);
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        expect(await h.physical()).toEqual(damaged);
        expect(h.fixture.fetchCalls()).toBe(0);
      } catch (inspectionError) {
        if (!targetFailed) throw inspectionError;
        console.info("BASISL04_READONLY_INSPECTION_FAILED");
      }
    }
  },
);

const append = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:appendStageEvent",
);

it("APPENDB01 appends canonical event1 after actual basis binding and preserves its receipt", async () => {
  const h = await boundOperation();
  // Complete generic unsigned event DATA; no typed C10/provider/Owner claim.
  const datum = {
    event: "dispatch",
    stage: "attach",
    request: h.fixture.request,
  };
  const event = await canonicalJournalEvent(1, canonical(datum));
  expect(JSON.parse(event.json)).toEqual(datum);
  const args = {
    reservation: h.reservation,
    expectedSequence: 0,
    event: {
      sequence: event.sequence,
      binding: event.binding,
      dataJSON: event.json,
    },
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(await h.physical()).toEqual(h.boundRows);
  let stable = h.boundRows;
  let targetFailed = false;
  try {
    // Actual existing registered append is currently fenced for V2.
    const appended = await h.t.mutation(append, args);
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
    const after = await h.physical();
    stable = after;
    expect(after.operations).toEqual(h.boundRows.operations);
    expect(after.attempts).toEqual([
      { ...h.boundRows.attempts[0], lastSequence: 1 },
    ]);
    expect(after.payloads).toHaveLength(2);
    expect(after.events).toHaveLength(1);
    expect(
      after.payloads.find((row) => row._id === h.reservation.payloadId),
    ).toEqual(h.boundRows.payloads[0]);
    const storedPayload = after.payloads.find(
      (row) => row._id === appended.payloadId,
    );
    expect(storedPayload).toBeDefined();
    if (!storedPayload) throw Error("APPENDB01_MISSING_REAL_PAYLOAD");
    expect(storedPayload).toEqual({
      _id: appended.payloadId,
      _creationTime: storedPayload._creationTime,
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
    expect(after.events[0]).toEqual({
      _id: appended.eventId,
      _creationTime: after.events[0]._creationTime,
      operationId: descriptor.operationId,
      attemptId: descriptor.attemptId,
      stage: descriptor.stage,
      sourcePayloadId: descriptor.sourcePayloadId,
      sequence: 1,
      binding: descriptor.binding,
      payloadId: descriptor.payloadId,
    });
    for (const rows of Object.values(after)) {
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    }
    const loaded = await h.t.query(load, h.queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual(h.loaded);
    const duplicateBasis = await h.t.mutation(bind, h.args);
    expect(getConvexSize(duplicateBasis)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(duplicateBasis).toEqual(h.receipt);
    expect(await h.physical()).toEqual(after);
    expect(canonical(h.fixture.record)).toBe(h.fixture.recordJSON);
  } catch (error) {
    targetFailed = true;
    console.info(
      "APPENDB01_TARGET_ERROR",
      error instanceof Error ? error.message : "NON_ERROR_THROW",
    );
    throw error;
  } finally {
    try {
      const after = await h.physical();
      console.info(
        "APPENDB01_SETTLEMENT",
        JSON.stringify({
          physicalEqual: JSON.stringify(after) === JSON.stringify(stable),
          rows: Object.fromEntries(
            Object.entries(after).map(([key, rows]) => [key, rows.length]),
          ),
          fetchCalls: h.fixture.fetchCalls(),
        }),
      );
      expect(after).toEqual(stable);
      expect(h.fixture.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("APPENDB01_READONLY_INSPECTION_FAILED");
    }
  }
});
