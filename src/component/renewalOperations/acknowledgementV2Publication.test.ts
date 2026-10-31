import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
import { captureAttachReceipt } from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import {
  materialize,
  eventDigest,
  objectNode,
  scalarNode,
} from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";
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
async function thirdArgs(h: Retained, receipt: Retained["receipt"]) {
  const datum = {
    event: "receipt",
    stage: "attach",
    request: h.request,
    receipt,
  };
  const node = captureAttachReceipt(datum);
  expect(materialize(node)).toEqual(datum);
  const full = await canonicalJournalEvent(3, canonical(datum));
  expect(full.binding).toBe(
    await eventDigest(
      objectNode([
        ["sequence", scalarNode(3)],
        ["data", node],
      ]),
    ),
  );
  const args = {
    reservation: h.acquired.reservation,
    expectedSequence: 2,
    event: { sequence: 3 as const, binding: full.binding, dataJSON: full.json },
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  return args;
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
async function checkStableKnown(h: Retained, expectedEvent: unknown = null) {
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
    expectedEvent,
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

it("ACKV203 publishes full matching typed event3 then keeps stale2 retention stable", async () => {
  const h = await retainedScenario();
  const args = await thirdArgs(h, h.receipt);
  let stable = h.after;
  let targetFailed = false;
  try {
    const committed = await h.t.mutation(append, args);
    const descriptor = {
      ...h.ownerScope,
      sourcePayloadId: h.known.sourcePayloadId,
      sequence: 3,
      binding: args.event.binding,
      payloadId: committed.payloadId,
      eventId: committed.eventId,
    };
    expect(committed).toEqual({
      ...descriptor,
      reservation: h.acquired.reservation,
    });
    expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
    const after = await h.physical();
    stable = after;
    expect(Object.values(after).map((rows) => rows.length)).toEqual([
      1, 1, 3, 5,
    ]);
    expect(after.operations).toEqual(h.after.operations);
    expect(after.attempts).toEqual([
      { ...h.after.attempts[0], lastSequence: 3 },
    ]);
    for (const row of h.after.payloads)
      expect(after.payloads.find((x) => x._id === row._id)).toEqual(row);
    for (const row of h.after.events)
      expect(after.events.find((x) => x._id === row._id)).toEqual(row);
    const payload = after.payloads.find(
      (row) => row._id === committed.payloadId,
    );
    assert(payload);
    expect(payload).toEqual({
      _id: committed.payloadId,
      _creationTime: payload._creationTime,
      codecVersion: 1,
      json: args.event.dataJSON,
      owner: { kind: "event", ...h.ownerScope, sequence: 3 },
    });
    const event = after.events.find((row) => row._id === committed.eventId);
    assert(event);
    const { eventId, ...fields } = descriptor;
    expect(event).toEqual({
      ...fields,
      _id: eventId,
      _creationTime: event._creationTime,
    });
    for (const group of Object.values(after))
      for (const row of group)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    await checkStableKnown(
      { ...h, after, commits: [...h.commits, committed] },
      { ...descriptor, dataJSON: args.event.dataJSON },
    );
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    await inspectStable(h, stable, targetFailed, "ACKV203_INSPECTION_FAILED");
  }
});

it.each(["contradictory", "malformed"] as const)(
  "ACKV204 refuses %s incoming event3 without writes",
  async (mode) => {
    const h = await retainedScenario();
    // Copied binding is invalid host C3 DATA; {} is not a typed C10 event.
    const candidate = contradictoryReceipt(h);
    expect(candidate.binding).toBe(h.receipt.binding);
    expect(canonical(candidate)).not.toBe(h.receiptJSON);
    const malformed = await canonicalJournalEvent(3, "{}");
    const args =
      mode === "contradictory"
        ? await thirdArgs(h, candidate)
        : {
            reservation: h.acquired.reservation,
            expectedSequence: 2,
            event: {
              sequence: 3 as const,
              binding: malformed.binding,
              dataJSON: malformed.json,
            },
          };
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    let targetFailed = false;
    try {
      await expect(h.t.mutation(append, args)).rejects.toThrow(
        /^RENEWAL_JOURNAL_CONFLICT$/,
      );
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      await inspectStable(
        h,
        h.after,
        targetFailed,
        "ACKV204_INSPECTION_FAILED",
      );
    }
  },
);
