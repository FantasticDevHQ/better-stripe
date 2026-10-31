import assert from "node:assert/strict";
import { makeFunctionReference } from "convex/server";
import { getConvexSize, getDocumentSize, type Infer } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import type {
  providerAcknowledgementReadResult,
  retentionReceipt,
} from "./schema.js";
import {
  prepareV2AcknowledgementScenario,
  append,
  retain,
  canonical,
  VALUE_LIMIT,
} from "./acknowledgement.fixtures.js";

const readAcknowledgement = makeFunctionReference<
  "query",
  { operationId: Infer<typeof retentionReceipt>["operationId"] },
  Infer<typeof providerAcknowledgementReadResult>
>("renewalOperations/queries:readProviderAcknowledgement");
afterEach(() => vi.unstubAllGlobals());

it("ACKV201 retains full V2 attach DATA after actual basis and events1/2", async () => {
  // Independent predeclared DATA expectations; no sampled runtime eligibility.
  const policy = {
    version: 1,
    firstDispatchedAt: 1700000001,
    periodStart: 1700000000,
    periodEnd: 1702592000,
    workEndWallMs: 1700000005000,
    endWallMs: 1700000006000,
  };
  const basis = {
    startWallMs: 1700000001000,
    startNsDecimal: "1000000000",
    workEndWallMs: 1700000005000,
    workEndNsDecimal: "5000000000",
    endWallMs: 1700000006000,
    endNsDecimal: "6000000000",
  };
  const h = await prepareV2AcknowledgementScenario();
  expect(h.scenario).toBe("clean");
  expect(h.shouldRetain).toBe(true);
  const operation = h.before.operations[0];
  const initialBasis = {
    version: 1,
    attemptId: h.acquired.reservation.attemptId,
    sourcePayloadId: h.acquired.reservation.payloadId,
    stage: "attach",
    policyJSON: canonical(policy),
    basisJSON: canonical(basis),
  };
  expect(operation.recordVersion).toBe(2);
  expect(operation.initialBasis).toEqual(initialBasis);
  const source = h.before.payloads.find(
    (row) => row._id === h.acquired.reservation.payloadId,
  );
  assert(source);
  const record = JSON.parse(source.json);
  expect(record.schemaVersion).toBe(2);
  expect(record.timingPolicy).toEqual(policy);
  expect(Object.prototype.hasOwnProperty.call(record, "basis")).toBe(false);
  expect(record.attachRequest).toEqual(h.raw.attachRequest);
  // Whole source equality includes its opaque bundle, without a layout gate.
  expect(source.json).toBe(h.acquired.reservation.recordJSON);
  expect(h.commits.map((event) => event.sequence)).toEqual([1, 2]);
  expect(h.before.attempts[0].lastSequence).toBe(2);
  expect(h.before.events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(Object.values(h.before).map((rows) => rows.length)).toEqual([
    1, 1, 2, 3,
  ]);
  expect(operation.knownAcknowledgement).toBeUndefined();
  expect(getConvexSize(h.args)).toBeLessThanOrEqual(VALUE_LIMIT);
  let stable = h.before;
  let targetFailed = false;
  try {
    // Real retention route after every owned/basis/history prerequisite above.
    const retained = await h.t.mutation(retain, h.args);
    assert(retained !== null);
    const known = {
      schemaVersion: 1,
      stage: "attach",
      attemptId: h.acquired.reservation.attemptId,
      sourcePayloadId: h.acquired.reservation.payloadId,
      dispatchEventId: h.commits[0].eventId,
      dispatchPayloadId: h.commits[0].payloadId,
      responseEventId: h.commits[1].eventId,
      responsePayloadId: h.commits[1].payloadId,
      receiptPayloadId: retained.receiptPayloadId,
      receiptBinding: h.receipt.binding,
    };
    expect(retained).toEqual({
      status: "retained",
      ...h.queryArgs,
      ...known,
    });
    expect(getConvexSize(retained)).toBeLessThanOrEqual(VALUE_LIMIT);
    const after = await h.physical();
    stable = after;
    expect(Object.values(after).map((rows) => rows.length)).toEqual([
      1, 1, 2, 4,
    ]);
    expect(after.operations).toEqual([
      { ...operation, knownAcknowledgement: known },
    ]);
    expect(after.operations[0].initialBasis).toEqual(initialBasis);
    expect(after.attempts).toEqual(h.before.attempts);
    expect(after.events).toEqual(h.before.events);
    for (const original of h.before.payloads)
      expect(after.payloads.find((row) => row._id === original._id)).toEqual(
        original,
      );
    const added = after.payloads.filter(
      (row) => !h.before.payloads.some((original) => original._id === row._id),
    );
    expect(added).toHaveLength(1);
    const receiptPayload = added[0];
    expect(Number.isFinite(receiptPayload._creationTime)).toBe(true);
    expect(receiptPayload).toEqual({
      _id: retained.receiptPayloadId,
      _creationTime: receiptPayload._creationTime,
      codecVersion: 1,
      json: h.receiptJSON,
      owner: { kind: "receipt", ...h.ownerScope },
    });
    expect(JSON.parse(receiptPayload.json)).toEqual(h.receipt);
    expect(after.events.some((event) => event.sequence === 3)).toBe(false);
    for (const rows of Object.values(after))
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    const queryArgs = { operationId: retained.operationId };
    expect(getConvexSize(queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const loaded = await h.t.query(readAcknowledgement, queryArgs);
    expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(loaded).toEqual({ retention: retained, receiptJSON: h.receiptJSON });
    expect(await h.physical()).toEqual(after);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      const after = await h.physical();
      console.info(
        "ACKV201_SETTLEMENT",
        JSON.stringify({
          physicalEqual: JSON.stringify(after) === JSON.stringify(stable),
          counts: Object.values(after).map((rows) => rows.length),
          lastSequence: after.attempts[0]?.lastSequence,
          fetchCalls: h.fetchCalls(),
        }),
      );
      expect(after).toEqual(stable);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("ACKV201_READONLY_INSPECTION_FAILED");
    }
  }
});

const bind = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:bindInitialBasis",
);
const load = makeFunctionReference<"query">(
  "renewalOperations/queries:loadAuthorizedOperation",
);
const manifest = makeFunctionReference<"query">(
  "renewalOperations/queries:readAttempt",
);
const readEvent = makeFunctionReference<"query">(
  "renewalOperations/queries:readStageEvent",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const contradictoryValue = "different-retained-full-body";
const corruptions = [
  "known-ref",
  "receipt-owner",
  "receipt-body",
  "missing-payload",
] as const;

async function retainedScenario() {
  const h = await prepareV2AcknowledgementScenario();
  expect(h.scenario).toBe("clean");
  expect(h.shouldRetain).toBe(true);
  expect(h.before.operations[0].recordVersion).toBe(2);
  const initialBasis = h.before.operations[0].initialBasis;
  assert(initialBasis);
  expect(h.before.attempts[0].lastSequence).toBe(2);
  expect(h.commits.map((row) => row.sequence)).toEqual([1, 2]);
  const retained = await h.t.mutation(retain, h.args);
  assert(retained !== null);
  const known = {
    schemaVersion: 1 as const,
    stage: "attach" as const,
    attemptId: h.acquired.reservation.attemptId,
    sourcePayloadId: h.acquired.reservation.payloadId,
    dispatchEventId: h.commits[0].eventId,
    dispatchPayloadId: h.commits[0].payloadId,
    responseEventId: h.commits[1].eventId,
    responsePayloadId: h.commits[1].payloadId,
    receiptPayloadId: retained.receiptPayloadId,
    receiptBinding: h.receipt.binding,
  };
  expect(retained).toEqual({ status: "retained", ...h.queryArgs, ...known });
  expect(getConvexSize(retained)).toBeLessThanOrEqual(VALUE_LIMIT);
  const after = await h.physical();
  expect(Object.values(after).map((rows) => rows.length)).toEqual([1, 1, 2, 4]);
  expect(after.operations).toEqual([
    { ...h.before.operations[0], knownAcknowledgement: known },
  ]);
  expect(after.attempts).toEqual(h.before.attempts);
  expect(after.events).toEqual(h.before.events);
  for (const old of h.before.payloads)
    expect(after.payloads.find((row) => row._id === old._id)).toEqual(old);
  const payload = after.payloads.find(
    (row) => row._id === retained.receiptPayloadId,
  );
  assert(payload);
  expect(payload).toEqual({
    _id: retained.receiptPayloadId,
    _creationTime: payload._creationTime,
    codecVersion: 1,
    json: h.receiptJSON,
    owner: { kind: "receipt", ...h.ownerScope },
  });
  for (const group of Object.values(after))
    for (const row of group)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  const expectedRead = { retention: retained, receiptJSON: h.receiptJSON };
  expect(await h.t.query(readAcknowledgement, h.queryArgs)).toEqual(
    expectedRead,
  );
  const { recordJSON, ...summary } = h.acquired.reservation;
  const loaded = await h.t.query(load, h.queryArgs);
  expect(loaded).toEqual({
    recordVersion: 2,
    ...h.queryArgs,
    recordJSON,
    revision: 1,
    activeAttempt: summary,
    initialBasis,
  });
  const bindArgs = {
    ...h.queryArgs,
    attemptId: known.attemptId,
    policyJSON: initialBasis.policyJSON,
    basisJSON: initialBasis.basisJSON,
  };
  const historyArgs = { ...h.queryArgs, attemptId: known.attemptId };
  const reserveArgs = {
    ...h.queryArgs,
    expectedRevision: 0,
    stage: "attach" as const,
    expectedRequestBinding: h.acquired.reservation.requestBinding,
    recordJSON,
  };
  const createArgs = {
    authorizationScope: h.acquired.reservation.authorizationScope,
    logicalOperationId: h.acquired.reservation.logicalOperationId,
    authorizationRevision: h.acquired.reservation.authorizationRevision,
    recordJSON,
  };
  const first = h.before.payloads.find(
    (row) => row._id === known.dispatchPayloadId,
  );
  assert(first);
  const duplicateArgs = {
    reservation: h.acquired.reservation,
    expectedSequence: 0,
    event: {
      sequence: 1 as const,
      binding: h.commits[0].binding,
      dataJSON: first.json,
    },
  };
  for (const args of [
    bindArgs,
    historyArgs,
    reserveArgs,
    createArgs,
    duplicateArgs,
    { ...historyArgs, sequence: 3 },
  ])
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(getConvexSize(loaded)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(getConvexSize(expectedRead)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(await h.physical()).toEqual(after);
  expect(h.fetchCalls()).toBe(0);
  return {
    ...h,
    retained,
    known,
    after,
    expectedRead,
    loaded,
    bindArgs,
    historyArgs,
    reserveArgs,
    createArgs,
    duplicateArgs,
  };
}

type Retained = Awaited<ReturnType<typeof retainedScenario>>;
function contradictoryReceipt(h: Retained) {
  const metadata = h.receipt.providerSnapshot.metadata;
  assert(metadata && typeof metadata === "object" && !Array.isArray(metadata));
  return {
    ...h.receipt,
    providerSnapshot: {
      ...h.receipt.providerSnapshot,
      metadata: { ...metadata, opaque: contradictoryValue },
    },
  };
}
async function inspectStable(
  h: Retained,
  rows: Retained["after"],
  failed: boolean,
  label: string,
) {
  try {
    expect(await h.physical()).toEqual(rows);
    expect(h.fetchCalls()).toBe(0);
  } catch (error) {
    if (!failed) throw error;
    console.info(label);
  }
}
async function checkStableKnown(h: Retained) {
  const events = h.commits.map(({ reservation, ...event }) => {
    expect(reservation).toEqual(h.acquired.reservation);
    return event;
  });
  const settled = await Promise.allSettled([
    h.t.mutation(retain, h.args),
    h.t.mutation(bind, h.bindArgs),
    h.t.query(readAcknowledgement, h.queryArgs),
    h.t.query(load, h.queryArgs),
    h.t.query(manifest, h.historyArgs),
    h.t.query(readEvent, { ...h.historyArgs, sequence: 3 }),
    h.t.mutation(reserve, h.reserveArgs),
    h.t.mutation(create, h.createArgs),
    h.t.mutation(append, h.duplicateArgs),
  ]);
  const values = settled.map((item) => {
    if (item.status !== "fulfilled") throw item.reason;
    expect(getConvexSize(item.value)).toBeLessThanOrEqual(VALUE_LIMIT);
    return item.value;
  });
  expect(values).toEqual([
    h.retained,
    { status: "bound", ...h.queryArgs, initialBasis: h.loaded.initialBasis },
    h.expectedRead,
    h.loaded,
    { reservation: h.acquired.reservation, events },
    null,
    {
      disposition: "existing",
      committedRevision: 1,
      reservation: h.acquired.reservation,
    },
    { status: "existing", ...h.queryArgs },
    h.commits[0],
  ]);
  expect(await h.physical()).toEqual(h.after);
}

it("ACKV202 keeps head2 retain, basis and full reads stable before event3", async () => {
  const h = await retainedScenario();
  let targetFailed = false;
  try {
    await checkStableKnown(h);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    await inspectStable(h, h.after, targetFailed, "ACKV202_INSPECTION_FAILED");
  }
});

it.each(corruptions)(
  "ACKV205 refuses %s known corruption through all eight APIs",
  async (kind) => {
    const h = await retainedScenario();
    await checkStableKnown(h);
    let expected = h.after;
    if (kind === "known-ref") {
      const knownAcknowledgement = {
        ...h.known,
        dispatchEventId: h.known.responseEventId,
      };
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperations", h.retained.operationId, {
          knownAcknowledgement,
        }),
      );
      expected = {
        ...expected,
        operations: [{ ...expected.operations[0], knownAcknowledgement }],
      };
    } else if (kind === "receipt-owner") {
      const owner = {
        kind: "receipt" as const,
        ...h.ownerScope,
        stage: "configure" as const,
      };
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", h.retained.receiptPayloadId, {
          owner,
        }),
      );
      expected = {
        ...expected,
        payloads: expected.payloads.map((row) =>
          row._id === h.retained.receiptPayloadId ? { ...row, owner } : row,
        ),
      };
    } else if (kind === "receipt-body") {
      const json = canonical(contradictoryReceipt(h));
      expect(json).not.toBe(h.receiptJSON);
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", h.retained.receiptPayloadId, {
          json,
        }),
      );
      expected = {
        ...expected,
        payloads: expected.payloads.map((row) =>
          row._id === h.retained.receiptPayloadId ? { ...row, json } : row,
        ),
      };
    } else if (kind === "missing-payload") {
      await h.t.run((ctx) =>
        ctx.db.delete("renewalOperationPayloads", h.retained.receiptPayloadId),
      );
      expected = {
        ...expected,
        payloads: expected.payloads.filter(
          (row) => row._id !== h.retained.receiptPayloadId,
        ),
      };
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
        h.t.query(readEvent, { ...h.historyArgs, sequence: 3 }),
        h.t.query(readAcknowledgement, h.queryArgs),
        h.t.mutation(reserve, h.reserveArgs),
        h.t.mutation(bind, h.bindArgs),
        h.t.mutation(create, h.createArgs),
        h.t.mutation(append, h.duplicateArgs),
      ]);
      console.info(
        "ACKV205_SETTLEMENT",
        JSON.stringify({ kind, statuses: settled.map((item) => item.status) }),
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
      await inspectStable(
        h,
        damaged,
        targetFailed,
        "ACKV205_INSPECTION_FAILED",
      );
    }
  },
);
