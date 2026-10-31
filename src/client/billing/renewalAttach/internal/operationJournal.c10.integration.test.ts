import assert from "node:assert/strict";
import { components } from "../../../../../example/convex/_generated/api.js";
import { createActionOperationJournal } from "./operationJournal.js";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  componentsGeneric,
  defineSchema,
  makeFunctionReference,
} from "convex/server";
import { getConvexSize, getDocumentSize, v } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../../../test.js";
import { query } from "../../../../component/_generated/server.js";
import type { Doc } from "../../../../component/_generated/dataModel.js";
import {
  canonical,
  codecFixture,
  VALUE_LIMIT,
} from "../../../../component/renewalOperations/timingPolicy.fixtures.js";
import { canonicalJournalEvent } from "../../../../shared/renewalOperationJournal.js";

const refs = components.betterStripe.renewalOperations;
const inspectionRefs = componentsGeneric();
const call = makeFunctionReference<"action", { operationId: string }, null>(
  "adapterC10:run",
);
const parentStop = "ADAPTER_C10_PARENT_STOP_AFTER_ACK";
const cases = [
  {
    name: "C10SEND01 ACK readback and committed event survive parent Action failure",
    sequence: 1,
    pending: false,
  },
  {
    name: "C10SEND02 real append rejection never ACKs",
    sequence: 2,
    pending: false,
  },
  {
    name: "C10SEND03 real pending append cannot ACK",
    sequence: 1,
    pending: true,
  },
] as const;
const basis = {
  startWallMs: 1700000001000,
  startNsDecimal: "1000000000",
  workEndWallMs: 1700000005000,
  workEndNsDecimal: "5000000000",
  endWallMs: 1700000006000,
  endNsDecimal: "6000000000",
};
type Physical = {
  operations: Doc<"renewalOperations">[];
  attempts: Doc<"renewalOperationAttempts">[];
  events: Doc<"renewalOperationEvents">[];
  payloads: Doc<"renewalOperationPayloads">[];
};
const inspection = {
  physical: query({
    args: {},
    handler: async (ctx): Promise<Physical> => ({
      operations: await ctx.db.query("renewalOperations").take(3),
      attempts: await ctx.db.query("renewalOperationAttempts").take(3),
      events: await ctx.db.query("renewalOperationEvents").take(4),
      payloads: await ctx.db.query("renewalOperationPayloads").take(5),
    }),
  }),
};
function measure(state: Physical) {
  expect(getConvexSize(state)).toBeLessThanOrEqual(VALUE_LIMIT);
  for (const rows of Object.values(state))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
}
afterEach(() => vi.unstubAllGlobals());

it.each(cases)("$name", async (scenario) => {
  // Finite unsigned DATA, not an Owner-qualified typed C10 producer capture.
  // All event/basis choices precede real constructors and transactions.
  const data = Object.freeze({
    future: Object.freeze([null, "retained", 1.25]),
  });
  const event = await canonicalJournalEvent(scenario.sequence, canonical(data));
  const record = Object.freeze({
    sequence: scenario.sequence,
    binding: event.binding,
    data,
  });
  const expectedHashBytes = new TextEncoder().encode(
    JSON.stringify([
      "betterstripe-renewal-binding",
      2,
      "unbound-qualification-event",
      { data: { future: [null, "retained", 1.25] }, sequence: 1 },
    ]),
  );
  let markEntered!: () => void;
  let releaseLatch!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const releaseGate = new Promise<void>((resolve) => {
    releaseLatch = resolve;
  });
  const nativeCalls: Promise<ArrayBuffer>[] = [];
  const forwardedCalls: Promise<ArrayBuffer>[] = [];
  const sendObservers: Promise<void>[] = [];
  const pending = {
    matches: 0,
    nativeFulfilled: false,
    released: false,
    sendSettled: false,
  };
  const release = () => {
    pending.released = true;
    releaseLatch();
  };
  let restoreDigest: () => void = () => undefined;
  const h = await codecFixture();
  const acks: unknown[] = [];
  const ackReads: Promise<Physical>[] = [];
  const progress = { prepared: 0, reserved: 0, bound: 0, target: 0, sent: 0 };
  let beforeTarget: Physical | null = null;
  let checkedCommitted: Physical | null = null;
  const host = {
    run: actionGeneric({
      args: { operationId: v.string() },
      handler: async (ctx, args) => {
        expect(await ctx.meta.getFunctionMetadata()).toEqual({
          name: "adapterC10:run",
          componentPath: "",
          type: "action",
          visibility: "public",
        });
        const prepared = await ctx.runQuery(
          refs.queries.loadAuthorizedOperation,
          args,
        );
        expect(prepared).toEqual({
          recordVersion: 2,
          ...args,
          recordJSON: h.recordJSON,
          revision: 0,
          activeAttempt: null,
          initialBasis: null,
        });
        progress.prepared++;
        const journal = await createActionOperationJournal(
          ctx,
          components.betterStripe,
          args.operationId,
        );
        const reserveInput = {
          expectedRevision: 0,
          stage: "attach" as const,
          expectedRequestBinding: h.record.requestBinding,
          recordJSON: h.recordJSON,
        };
        expect(getConvexSize({ ...args, ...reserveInput })).toBeLessThanOrEqual(
          VALUE_LIMIT,
        );
        const acquired = await journal.reserveAttempt(reserveInput);
        assert(acquired && acquired.disposition === "acquired");
        const reservation = acquired.reservation;
        assert(
          "recordVersion" in reservation && reservation.recordVersion === 2,
        );
        const reserved = await ctx.runQuery(
          inspectionRefs.betterStripe.adapterC10Inspection.physical,
          {},
        );
        expect(reserved.operations).toHaveLength(1);
        expect(reserved.attempts).toHaveLength(1);
        expect(reserved.events).toHaveLength(0);
        expect(reserved.payloads).toHaveLength(1);
        expect(reservation).toEqual({
          operationId: args.operationId,
          attemptId: reserved.attempts[0]._id,
          payloadId: reserved.payloads[0]._id,
          authorizationScope: h.record.authorization.scope,
          authorizationId: h.record.authorization.id,
          authorizationRevision: h.record.authorization.revision,
          logicalOperationId: h.record.logicalOperationId,
          requestBinding: h.record.requestBinding,
          key: h.request.key,
          apiVersion: h.record.apiVersion,
          accountJSON: canonical(h.record.account),
          firstDispatchedAt: h.request.firstDispatchedAt,
          ordinal: 1,
          preparedRevision: 0,
          committedRevision: 1,
          recordJSON: h.recordJSON,
          recordVersion: 2,
          stage: "attach",
          timingPolicyJSON: canonical(h.record.timingPolicy),
        });
        expect(acquired).toEqual({
          disposition: "acquired",
          previousRevision: 0,
          committedRevision: 1,
          reservation,
        });
        expect(reserved.payloads[0].json).toBe(h.recordJSON);
        expect(reserved.payloads[0].owner).toEqual({
          kind: "operation",
          ...args,
        });
        expect(reserved.operations[0].activeAttemptId).toBe(
          reservation.attemptId,
        );
        expect(reserved.attempts[0].lastSequence).toBe(0);
        measure(reserved);
        progress.reserved++;
        const bindInput = {
          attemptId: reservation.attemptId,
          policyJSON: canonical(h.record.timingPolicy),
          basisJSON: canonical(basis),
        };
        expect(getConvexSize({ ...args, ...bindInput })).toBeLessThanOrEqual(
          VALUE_LIMIT,
        );
        const bound = await journal.bindInitialBasis(bindInput);
        expect(bound).toEqual({
          status: "bound",
          ...args,
          initialBasis: {
            version: 1,
            attemptId: reservation.attemptId,
            sourcePayloadId: reservation.payloadId,
            stage: "attach",
            policyJSON: bindInput.policyJSON,
            basisJSON: bindInput.basisJSON,
          },
        });
        const targetSnapshot: Physical = await ctx.runQuery(
          inspectionRefs.betterStripe.adapterC10Inspection.physical,
          {},
        );
        beforeTarget = targetSnapshot;
        measure(targetSnapshot);
        expect(targetSnapshot.operations[0].initialBasis).toEqual(
          bound?.initialBasis,
        );
        expect(targetSnapshot.attempts).toEqual(reserved.attempts);
        expect(targetSnapshot.payloads).toEqual(reserved.payloads);
        expect(targetSnapshot.events).toEqual([]);
        const { recordJSON: _recordJSON, ...summary } = reservation;
        const boundLoad = {
          recordVersion: 2,
          ...args,
          recordJSON: h.recordJSON,
          revision: 1,
          activeAttempt: summary,
          initialBasis: bound?.initialBasis,
        };
        expect(await journal.loadAuthorizedOperation()).toEqual(boundLoad);
        progress.bound++;
        const sender = journal.createC10Send(reservation);
        expect(typeof sender).toBe("function");
        const expectedArgs = {
          reservation,
          expectedSequence: record.sequence - 1,
          event: {
            sequence: record.sequence,
            binding: record.binding,
            dataJSON: event.json,
          },
        };
        expect(getConvexSize(expectedArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
        if (scenario.pending) {
          const subtle = globalThis.crypto.subtle;
          const original = subtle.digest;
          const ownDescriptor = Object.getOwnPropertyDescriptor(
            subtle,
            "digest",
          );
          const proof = await original.call(
            subtle,
            "SHA-256",
            expectedHashBytes,
          );
          expect(
            "unbound-qualification-event:v2:sha256:" +
              Array.from(new Uint8Array(proof), (n) =>
                n.toString(16).padStart(2, "0"),
              ).join(""),
          ).toBe(event.binding);
          // This actual shared native object's OWN method is instrumented;
          // nested handlers do not inherit an Action crypto-global override.
          const spy = vi
            .spyOn(subtle, "digest")
            .mockImplementation((algorithm, input) => {
              const bytes = ArrayBuffer.isView(input)
                ? new Uint8Array(
                    input.buffer,
                    input.byteOffset,
                    input.byteLength,
                  ).slice()
                : new Uint8Array(input).slice();
              const match =
                algorithm === "SHA-256" &&
                bytes.length === expectedHashBytes.length &&
                bytes.every(
                  (value, index) => value === expectedHashBytes[index],
                );
              if (match) pending.matches++;
              const selected = match && pending.matches === 2;
              const native = original.call(subtle, algorithm, input);
              nativeCalls.push(native);
              const forwarded = native.then(async (result) => {
                if (selected) {
                  pending.nativeFulfilled = true;
                  markEntered();
                  await releaseGate;
                }
                return result;
              });
              forwardedCalls.push(forwarded);
              return forwarded;
            });
          restoreDigest = () => {
            spy.mockRestore();
            if (ownDescriptor)
              Object.defineProperty(subtle, "digest", ownDescriptor);
            else expect(Reflect.deleteProperty(subtle, "digest")).toBe(true);
            expect(Object.getOwnPropertyDescriptor(subtle, "digest")).toEqual(
              ownDescriptor,
            );
          };
        }
        progress.target++;
        const ack = (value: unknown) => {
          acks.push(value);
          // This real query begins from ACK, but may queue behind an already
          // started append. Readback alone does not discriminate an early ACK;
          // C10SEND03 checks the actual pending handler directly.
          ackReads.push(
            ctx.runQuery(
              inspectionRefs.betterStripe.adapterC10Inspection.physical,
              {},
            ),
          );
        };
        try {
          const send = sender(record, ack);
          sendObservers.push(
            send.then(
              () => {
                pending.sendSettled = true;
              },
              () => {
                pending.sendSettled = true;
              },
            ),
          );
          if (scenario.sequence === 2) {
            await expect(send).rejects.toThrow(/^RENEWAL_JOURNAL_CONFLICT$/);
            expect(acks).toEqual([]);
            expect(ackReads).toEqual([]);
            expect(
              await ctx.runQuery(
                inspectionRefs.betterStripe.adapterC10Inspection.physical,
                {},
              ),
            ).toEqual(targetSnapshot);
            return null;
          }
          await send;
          progress.sent++;
          expect(acks).toEqual([{ sequence: 1, binding: event.binding }]);
          const reads = await Promise.all(ackReads);
          expect(reads).toHaveLength(1);
          const committed = reads[0];
          measure(committed);
          expect(committed.operations).toEqual(targetSnapshot.operations);
          expect(committed.attempts).toEqual([
            { ...targetSnapshot.attempts[0], lastSequence: 1 },
          ]);
          expect(committed.events).toHaveLength(1);
          expect(committed.payloads).toHaveLength(2);
          const row = committed.events[0];
          expect(row).toEqual({
            _id: row._id,
            _creationTime: row._creationTime,
            operationId: reservation.operationId,
            attemptId: reservation.attemptId,
            stage: "attach",
            sourcePayloadId: reservation.payloadId,
            sequence: 1,
            binding: event.binding,
            payloadId: row.payloadId,
          });
          expect(
            committed.payloads.find((p) => p._id === reservation.payloadId),
          ).toEqual(targetSnapshot.payloads[0]);
          const payload = committed.payloads.find(
            (p) => p._id === row.payloadId,
          );
          assert(payload && payload._id !== reservation.payloadId);
          expect(payload).toEqual({
            _id: row.payloadId,
            _creationTime: payload._creationTime,
            codecVersion: 1,
            json: event.json,
            owner: {
              kind: "event",
              operationId: reservation.operationId,
              attemptId: reservation.attemptId,
              stage: "attach",
              sequence: 1,
            },
          });
          expect(
            await ctx.runQuery(refs.queries.readStageEvent, {
              ...args,
              attemptId: reservation.attemptId,
              sequence: 1,
            }),
          ).toEqual({
            eventId: row._id,
            operationId: row.operationId,
            attemptId: row.attemptId,
            stage: row.stage,
            sourcePayloadId: row.sourcePayloadId,
            sequence: 1,
            binding: event.binding,
            payloadId: row.payloadId,
            dataJSON: event.json,
          });
          expect(await journal.loadAuthorizedOperation()).toEqual(boundLoad);
          checkedCommitted = committed;
          throw Error(parentStop);
        } finally {
          // Every query launched by an ACK is drained even if send/assertion
          // fails. No real RPC/query Promise is abandoned during inspection.
          await Promise.allSettled(ackReads);
        }
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./adapterC10.ts": async () => host,
  });
  expect(
    Object.prototype.hasOwnProperty.call(
      modules,
      "./component/adapterC10Inspection.ts",
    ),
  ).toBe(false);
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/adapterC10Inspection.ts": async () => inspection,
  });
  const physical = (): Promise<Physical> =>
    t.query(inspectionRefs.betterStripe.adapterC10Inspection.physical, {});
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const created = await t.mutation(refs.mutations.createAuthorizedOperation, {
    authorizationScope: h.record.authorization.scope,
    authorizationRevision: h.record.authorization.revision,
    logicalOperationId: h.record.logicalOperationId,
    recordJSON: h.recordJSON,
  });
  assert(created.status === "created");
  let failed = false;
  const action = t.action(call, { operationId: created.operationId });
  try {
    if (scenario.pending) {
      await Promise.race([
        entered,
        action.then(() => {
          throw Error("C10_PENDING_GATE_NOT_REACHED");
        }),
      ]);
      // The actual append handler is held before writes. Never query the DB
      // while it owns the transaction lock; inspect only causal local facts.
      expect(pending).toEqual({
        matches: 2,
        nativeFulfilled: true,
        released: false,
        sendSettled: false,
      });
      expect(acks).toEqual([]);
      expect(ackReads).toEqual([]);
      release();
    }
    if (scenario.sequence === 1) {
      let stopped = false;
      try {
        await action;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== parentStop)
          throw error;
        stopped = true;
      }
      expect(stopped).toBe(true);
      expect(progress).toEqual({
        prepared: 1,
        reserved: 1,
        bound: 1,
        target: 1,
        sent: 1,
      });
      expect(checkedCommitted).not.toBeNull();
    } else {
      await action;
      expect(progress).toEqual({
        prepared: 1,
        reserved: 1,
        bound: 1,
        target: 1,
        sent: 0,
      });
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    release();
    await Promise.allSettled([action]);
    await Promise.allSettled([
      ...nativeCalls,
      ...forwardedCalls,
      ...sendObservers,
      ...ackReads,
    ]);
    try {
      restoreDigest();
      const after = await physical();
      measure(after);
      if (beforeTarget !== null)
        expect(after).toEqual(checkedCommitted ?? beforeTarget);
      expect(h.fetchCalls()).toBe(0);
      console.info(
        "ADAPTER_C10_SETTLEMENT",
        JSON.stringify({
          sequence: scenario.sequence,
          ...progress,
          ackCount: acks.length,
          eventCount: after.events.length,
          payloadCount: after.payloads.length,
          committedSurvivedParentFailure: checkedCommitted !== null,
          fetchCalls: 0,
          pendingCase: scenario.pending,
          matchingHashes: pending.matches,
        }),
      );
    } catch (error) {
      if (!failed) throw error;
      console.info("ADAPTER_C10_INSPECTION_FAILED");
    }
  }
});
