import assert from "node:assert/strict";
import { makeFunctionReference } from "convex/server";
import {
  getConvexSize,
  getDocumentSize,
  type Infer,
  type ObjectType,
} from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import type {
  retentionReceipt,
  providerAcknowledgementReadResult,
  knownAcknowledgement,
  appendArgs,
} from "./schema.js";
import {
  prepareAcknowledgementScenario,
  retain,
  append,
  canonical,
  VALUE_LIMIT,
} from "./acknowledgement.fixtures.js";

import { canonicalJournalEvent } from "../../shared/renewalOperationJournal.js";
import { captureAttachReceipt } from "../../client/billing/renewalAttach/internal/c10/eventCapture.js";
import { materialize } from "../../client/billing/renewalAttach/internal/c10/eventCodec.js";

const readAcknowledgement = makeFunctionReference<
  "query",
  { operationId: Infer<typeof retentionReceipt>["operationId"] },
  Infer<typeof providerAcknowledgementReadResult>
>("renewalOperations/queries:readProviderAcknowledgement");
afterEach(() => vi.unstubAllGlobals());

it("READACK01 returns the complete owned known receipt and stable retention DATA", async () => {
  const h = await prepareAcknowledgementScenario("clean");
  const retained = await h.t.mutation(retain, h.args);
  assert(retained);
  expect(getConvexSize(retained)).toBeLessThanOrEqual(VALUE_LIMIT);
  const expectedKnown = {
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
    ...expectedKnown,
  });
  const before = await h.physical();
  expect(Object.values(before).map((rows) => rows.length)).toEqual([
    1, 1, 2, 4,
  ]);
  expect(before.operations[0].knownAcknowledgement).toEqual(expectedKnown);
  expect(before.operations[0].revision).toBe(1);
  expect(before.attempts[0].lastSequence).toBe(2);
  const payload = before.payloads.find(
    (row) => row._id === retained.receiptPayloadId,
  );
  assert(payload);
  expect(payload.codecVersion).toBe(1);
  expect(payload.owner).toEqual({ kind: "receipt", ...h.ownerScope });
  expect(payload.json).toBe(h.receiptJSON);
  expect(JSON.parse(payload.json)).toEqual(h.receipt);
  for (const row of h.before.payloads)
    expect(
      before.payloads.find((candidate) => candidate._id === row._id),
    ).toEqual(row);
  expect(before.attempts).toEqual(h.before.attempts);
  expect(before.events).toEqual(h.before.events);
  expect(
    Object.fromEntries(
      Object.entries(before.operations[0]).filter(
        ([key]) => key !== "knownAcknowledgement",
      ),
    ),
  ).toEqual(h.before.operations[0]);
  for (const rows of Object.values(before))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  const args = { operationId: retained.operationId };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const expected = { retention: retained, receiptJSON: h.receiptJSON };
  expect(getConvexSize(expected)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(h.fetchCalls()).toBe(0);
  let received = false;
  let returnedNull = false;
  let valueBytes = -1;
  let targetError: unknown;
  try {
    const actual = await h.t.query(readAcknowledgement, args);
    received = true;
    returnedNull = actual === null;
    valueBytes = getConvexSize(actual);
    expect(valueBytes).toBeLessThanOrEqual(VALUE_LIMIT);
    // The intended null-vs-complete-known-result RED occurs only HERE.
    expect(actual).not.toBeNull();
    expect(actual).toEqual(expected);
  } catch (error) {
    targetError = error;
    throw error;
  } finally {
    try {
      const after = await h.physical();
      const physicalEqual = JSON.stringify(after) === JSON.stringify(before);
      console.info(
        "READACK01_SETTLEMENT",
        JSON.stringify({
          received,
          returnedNull,
          valueBytes,
          physicalEqual,
          counts: Object.values(after).map((rows) => rows.length),
          lastSequence: after.attempts[0]?.lastSequence,
          fetchCalls: h.fetchCalls(),
        }),
      );
      expect(physicalEqual).toBe(true);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (targetError !== undefined) throw targetError;
      throw inspectionError;
    }
  }
});

const create = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:createAuthorizedOperation",
);
const reserve = makeFunctionReference<"mutation">(
  "renewalOperations/mutations:reserveAttempt",
);
type ReaderFixture = Awaited<ReturnType<typeof prepareAcknowledgementScenario>>;
async function unchanged(h: ReaderFixture, target: () => Promise<void>) {
  const before = await h.physical();
  expect(getConvexSize(before)).toBeLessThanOrEqual(VALUE_LIMIT);
  for (const rows of Object.values(before))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  expect(h.fetchCalls()).toBe(0);
  let failed = false;
  let originalError: unknown;
  try {
    await target();
  } catch (error) {
    failed = true;
    originalError = error;
    throw error;
  } finally {
    try {
      const after = await h.physical();
      expect(after).toEqual(before);
      expect(getConvexSize(after)).toBeLessThanOrEqual(VALUE_LIMIT);
      for (const rows of Object.values(after))
        for (const row of rows)
          expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
      expect(h.fetchCalls()).toBe(0);
    } catch (inspectionError) {
      if (failed) throw originalError;
      throw inspectionError;
    }
  }
}
async function cleanKnown() {
  const h = await prepareAcknowledgementScenario("clean");
  expect(getConvexSize(h.args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const retained = await h.t.mutation(retain, h.args);
  assert(retained);
  const known: Infer<typeof knownAcknowledgement> = {
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
  expect(retained).toEqual({ status: "retained", ...h.queryArgs, ...known });
  expect(getConvexSize(retained)).toBeLessThanOrEqual(VALUE_LIMIT);
  const rows = await h.physical();
  expect(rows.operations).toHaveLength(1);
  expect(rows.attempts).toHaveLength(1);
  expect(rows.events).toHaveLength(2);
  expect(rows.payloads).toHaveLength(4);
  expect(rows.operations[0].knownAcknowledgement).toEqual(known);
  const payload = rows.payloads.find(
    (row) => row._id === retained.receiptPayloadId,
  );
  assert(payload);
  expect(payload.json).toBe(h.receiptJSON);
  expect(JSON.parse(payload.json)).toEqual(h.receipt);
  expect(payload.owner).toEqual({ kind: "receipt", ...h.ownerScope });
  return { ...h, retained, known };
}
async function createPreparedB(h: ReaderFixture) {
  const parsed: unknown = JSON.parse(h.acquired.reservation.recordJSON);
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
  );
  // New host operation DATA only; original source/dispatch/body stay unchanged.
  const recordJSON = canonical({
    ...parsed,
    logicalOperationId: "read-ack-operation-B",
  });
  const args = {
    authorizationScope: h.acquired.reservation.authorizationScope,
    authorizationRevision: h.acquired.reservation.authorizationRevision,
    logicalOperationId: "read-ack-operation-B",
    recordJSON,
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const created = await h.t.mutation(create, args);
  expect(created.status).toBe("created");
  expect(created.operationId).not.toBe(h.queryArgs.operationId);
  expect(getConvexSize(created)).toBeLessThanOrEqual(VALUE_LIMIT);
  const row = await h.t.run((ctx) =>
    ctx.db.get("renewalOperations", created.operationId),
  );
  assert(row);
  expect(row.state).toBe("PREPARED");
  expect(row.revision).toBe(0);
  expect(row.activeAttemptId).toBeUndefined();
  expect(row.knownAcknowledgement).toBeUndefined();
  const payload = await h.t.run((ctx) =>
    ctx.db.get("renewalOperationPayloads", row.payloadId),
  );
  assert(payload);
  expect(payload.codecVersion).toBe(1);
  expect(payload.json).toBe(recordJSON);
  expect(payload.owner).toEqual({
    kind: "operation",
    operationId: created.operationId,
  });
  return { operationId: created.operationId, recordJSON };
}

it.each(["missing", "prepared", "reserved"] as const)(
  "READACK-null %s actual operation has no known acknowledgement",
  async (mode) => {
    const h = await cleanKnown();
    const b = await createPreparedB(h);
    if (mode === "missing") {
      await h.t.run((ctx) => ctx.db.delete("renewalOperations", b.operationId));
      expect(
        await h.t.run((ctx) => ctx.db.get("renewalOperations", b.operationId)),
      ).toBeNull();
    } else if (mode === "reserved") {
      const args = {
        operationId: b.operationId,
        expectedRevision: 0,
        stage: "attach",
        expectedRequestBinding: h.acquired.reservation.requestBinding,
        recordJSON: b.recordJSON,
      };
      expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
      const acquired = await h.t.mutation(reserve, args);
      expect(acquired.disposition).toBe("acquired");
      expect(acquired.reservation.operationId).toBe(b.operationId);
      expect(acquired.reservation.attemptId).not.toBe(
        h.acquired.reservation.attemptId,
      );
      expect(getConvexSize(acquired)).toBeLessThanOrEqual(VALUE_LIMIT);
      const stored = await h.physical();
      const operation = stored.operations.find(
        (row) => row._id === b.operationId,
      );
      const attempt = stored.attempts.find(
        (row) => row._id === acquired.reservation.attemptId,
      );
      assert(operation && attempt);
      expect(operation.state).toBe("RESERVED");
      expect(operation.knownAcknowledgement).toBeUndefined();
      expect(attempt.operationId).toBe(b.operationId);
      expect(attempt.lastSequence).toBe(0);
    }
    const args = { operationId: b.operationId };
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    await unchanged(h, async () => {
      const result = await h.t.query(readAcknowledgement, args);
      expect(result).toBeNull();
      expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
    });
  },
);

it("READACK-foreign PREPARED B with actual known A reference conflicts before null", async () => {
  const h = await cleanKnown();
  const b = await createPreparedB(h);
  await h.t.run((ctx) =>
    ctx.db.patch("renewalOperations", b.operationId, {
      knownAcknowledgement: h.known,
    }),
  );
  const rows = await h.physical();
  const operationB = rows.operations.find((row) => row._id === b.operationId);
  assert(operationB);
  expect(operationB.state).toBe("PREPARED");
  expect(operationB.activeAttemptId).toBeUndefined();
  expect(rows.attempts.some((row) => row.operationId === b.operationId)).toBe(
    false,
  );
  expect(operationB.knownAcknowledgement).toEqual(h.known);
  const args = { operationId: b.operationId };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  await unchanged(h, async () => {
    await expect(h.t.query(readAcknowledgement, args)).rejects.toThrow(
      /^RENEWAL_JOURNAL_CONFLICT$/,
    );
  });
});

const readerCorruptions = [
  "receipt-owner",
  "response-reference",
  "chain-head",
  "event-hash",
  "receipt-json",
  "missing-receipt",
] as const;
it.each(readerCorruptions)(
  "READACK-corrupt %s refuses without repair",
  async (mode) => {
    const h = await cleanKnown();
    if (mode === "receipt-owner") {
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", h.retained.receiptPayloadId, {
          owner: { kind: "operation", operationId: h.queryArgs.operationId },
        }),
      );
    } else if (mode === "response-reference") {
      expect(h.commits[0].payloadId).not.toBe(h.commits[1].payloadId);
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperations", h.queryArgs.operationId, {
          knownAcknowledgement: {
            ...h.known,
            responsePayloadId: h.commits[0].payloadId,
          },
        }),
      );
    } else if (mode === "chain-head") {
      await h.t.run((ctx) =>
        ctx.db.patch(
          "renewalOperationAttempts",
          h.acquired.reservation.attemptId,
          { lastSequence: 1 },
        ),
      );
    } else if (mode === "event-hash") {
      expect(h.commits[0].binding).not.toBe(h.commits[1].binding);
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationEvents", h.commits[1].eventId, {
          binding: h.commits[0].binding,
        }),
      );
    } else if (mode === "receipt-json") {
      const changedJSON = canonical({
        ...h.receipt,
        providerSnapshot: {
          ...h.receipt.providerSnapshot,
          reader_drift: { preserve: "conflict" },
        },
      });
      expect(changedJSON).not.toBe(h.receiptJSON);
      expect(JSON.parse(changedJSON).binding).toBe(h.receipt.binding);
      await h.t.run((ctx) =>
        ctx.db.patch("renewalOperationPayloads", h.retained.receiptPayloadId, {
          json: changedJSON,
        }),
      );
    } else {
      await h.t.run((ctx) =>
        ctx.db.delete("renewalOperationPayloads", h.retained.receiptPayloadId),
      );
    }
    expect(getConvexSize(h.queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    await unchanged(h, async () => {
      await expect(h.t.query(readAcknowledgement, h.queryArgs)).rejects.toThrow(
        /^RENEWAL_JOURNAL_CONFLICT$/,
      );
    });
  },
);

it("READACK-after3 getter preserves the exact full receipt and original descriptor", async () => {
  const h = await cleanKnown();
  expect(getConvexSize(h.queryArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const expected = { retention: h.retained, receiptJSON: h.receiptJSON };
  expect(getConvexSize(expected)).toBeLessThanOrEqual(VALUE_LIMIT);
  await unchanged(h, async () => {
    const actual = await h.t.query(readAcknowledgement, h.queryArgs);
    expect(actual).toEqual(expected);
    expect(getConvexSize(actual)).toBeLessThanOrEqual(VALUE_LIMIT);
  });
  const captured = captureAttachReceipt(h.receiptEvent);
  expect(materialize(captured)).toEqual(h.receiptEvent);
  const event = await canonicalJournalEvent(3, canonical(h.receiptEvent));
  const args: ObjectType<typeof appendArgs> = {
    reservation: h.acquired.reservation,
    expectedSequence: 2,
    event: {
      sequence: 3,
      binding: event.binding,
      dataJSON: event.json,
    },
  };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  const committed = await h.t.mutation(append, args);
  expect(committed.sequence).toBe(3);
  expect(committed.binding).toBe(event.binding);
  expect(committed.reservation).toEqual(h.acquired.reservation);
  expect(getConvexSize(committed)).toBeLessThanOrEqual(VALUE_LIMIT);
  const rows = await h.physical();
  expect(rows.events).toHaveLength(3);
  expect(rows.attempts[0].lastSequence).toBe(3);
  expect(rows.operations[0].knownAcknowledgement).toEqual(h.known);
  await unchanged(h, async () => {
    const actual = await h.t.query(readAcknowledgement, h.queryArgs);
    expect(actual).toEqual(expected);
    expect(getConvexSize(actual)).toBeLessThanOrEqual(VALUE_LIMIT);
  });
});

it("READACK-closed args reject an extra actual receipt payload selector", async () => {
  const h = await cleanKnown();
  const args = { ...h.queryArgs, payloadId: h.retained.receiptPayloadId };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  await unchanged(h, async () => {
    await expect(h.t.query(readAcknowledgement, args)).rejects.toThrow(
      /^Validator error:/,
    );
  });
});
