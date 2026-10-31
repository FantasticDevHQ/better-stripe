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
import { getConvexSize, getDocumentSize, v, type Value } from "convex/values";
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
  "adapterMethods:run",
);
const basis = {
  startWallMs: 1700000001000,
  startNsDecimal: "1000000000",
  workEndWallMs: 1700000005000,
  workEndNsDecimal: "5000000000",
  endWallMs: 1700000006000,
  endNsDecimal: "6000000000",
};
const methods = [
  "reserveAttempt",
  "bindInitialBasis",
  "appendStageEvent",
  "readAttempt",
  "readStageEvent",
] as const;
const identities = ["runQuery", "runMutation", "getFunctionMetadata"] as const;
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
      operations: await ctx.db.query("renewalOperations").take(4),
      attempts: await ctx.db.query("renewalOperationAttempts").take(4),
      events: await ctx.db.query("renewalOperationEvents").take(7),
      payloads: await ctx.db.query("renewalOperationPayloads").take(9),
    }),
  }),
};
afterEach(() => vi.unstubAllGlobals());

it.each(methods)(
  "ADAPTER-METHOD %s returns original complete committed DATA",
  async (method) => {
    // Entire event/basis recipe precedes constructors and real transactions.
    const event = await canonicalJournalEvent(
      1,
      canonical({ future: [null, "retained", 1.25] }),
    );
    const h = await codecFixture();
    const progress = { direct: 0, captured: 0, target: 0 };
    const host = {
      run: actionGeneric({
        args: { operationId: v.string() },
        handler: async (ctx, args) => {
          expect(await ctx.meta.getFunctionMetadata()).toEqual({
            name: "adapterMethods:run",
            componentPath: "",
            type: "action",
            visibility: "public",
          });
          const directLoad = await ctx.runQuery(
            refs.queries.loadAuthorizedOperation,
            args,
          );
          assert(
            directLoad &&
              "recordVersion" in directLoad &&
              directLoad.recordVersion === 2 &&
              directLoad.activeAttempt,
          );
          expect(directLoad.recordJSON).toBe(h.recordJSON);
          expect(directLoad.initialBasis).toEqual(bound.initialBasis);
          expect(
            await ctx.runQuery(
              inspectionRefs.betterStripe.adapterMethodsInspection.physical,
              {},
            ),
          ).toEqual(before);
          const journal = await createActionOperationJournal(
            ctx,
            components.betterStripe,
            args.operationId,
          );
          progress.captured++;
          let direct: Value;
          let actual: Value;
          if (method === "reserveAttempt") {
            const input = {
              expectedRevision: 0,
              stage: "attach" as const,
              expectedRequestBinding: h.record.requestBinding,
              recordJSON: h.recordJSON,
            };
            direct = await ctx.runMutation(refs.mutations.reserveAttempt, {
              ...args,
              ...input,
            });
            expect(direct).toEqual({
              disposition: "existing",
              committedRevision: 1,
              reservation,
            });
            progress.direct++;
            actual = await journal.reserveAttempt(input);
          } else if (method === "bindInitialBasis") {
            const input = {
              attemptId: reservation.attemptId,
              policyJSON: canonical(h.record.timingPolicy),
              basisJSON: canonical(basis),
            };
            direct = await ctx.runMutation(refs.mutations.bindInitialBasis, {
              ...args,
              ...input,
            });
            expect(direct).toEqual(bound);
            progress.direct++;
            actual = await journal.bindInitialBasis(input);
          } else if (method === "appendStageEvent") {
            const input = {
              reservation,
              expectedSequence: 0,
              event: {
                sequence: 1 as const,
                binding: event.binding,
                dataJSON: event.json,
              },
            };
            direct = await ctx.runMutation(
              refs.mutations.appendStageEvent,
              input,
            );
            expect(direct).toEqual(committed);
            progress.direct++;
            actual = await journal.appendStageEvent(input);
          } else if (method === "readAttempt") {
            const input = { attemptId: reservation.attemptId };
            direct = await ctx.runQuery(refs.queries.readAttempt, {
              ...args,
              ...input,
            });
            const { reservation: _reservation, ...descriptor } = committed;
            expect(direct).toEqual({
              reservation,
              events: [descriptor],
            });
            progress.direct++;
            actual = await journal.readAttempt(input);
          } else {
            const input = {
              attemptId: reservation.attemptId,
              sequence: 1 as const,
            };
            direct = await ctx.runQuery(refs.queries.readStageEvent, {
              ...args,
              ...input,
            });
            const { reservation: _reservation, ...descriptor } = committed;
            expect(direct).toEqual({ ...descriptor, dataJSON: event.json });
            progress.direct++;
            actual = await journal.readStageEvent(input);
          }
          progress.target++;
          expect(getConvexSize(actual)).toBeLessThanOrEqual(VALUE_LIMIT);
          expect(actual).toEqual(direct);
          return null;
        },
      }),
    };
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./adapterMethods.ts": async () => host,
    });
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/adapterMethodsInspection.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(
        inspectionRefs.betterStripe.adapterMethodsInspection.physical,
        {},
      );
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
    const args = { operationId: created.operationId };
    const acquired = await t.mutation(refs.mutations.reserveAttempt, {
      ...args,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: h.record.requestBinding,
      recordJSON: h.recordJSON,
    });
    assert(acquired.disposition === "acquired");
    const reservation = acquired.reservation;
    const bound = await t.mutation(refs.mutations.bindInitialBasis, {
      ...args,
      attemptId: reservation.attemptId,
      policyJSON: canonical(h.record.timingPolicy),
      basisJSON: canonical(basis),
    });
    const committed = await t.mutation(refs.mutations.appendStageEvent, {
      reservation,
      expectedSequence: 0,
      event: { sequence: 1, binding: event.binding, dataJSON: event.json },
    });
    expect(committed.reservation).toEqual(reservation);
    const before = await physical();
    expect(before.operations[0].initialBasis).toEqual(bound.initialBasis);
    expect(before.attempts[0].lastSequence).toBe(1);
    expect(before.events).toHaveLength(1);
    expect(before.payloads).toHaveLength(2);
    const source = before.payloads.find(
      (row) => row._id === reservation.payloadId,
    );
    assert(source);
    expect(source.json).toBe(h.recordJSON);
    expect(source.owner).toEqual({ kind: "operation", ...args });
    for (const rows of Object.values(before))
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    let failed = false;
    try {
      await t.action(call, args);
      expect(progress).toEqual({ direct: 1, captured: 1, target: 1 });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        expect(await physical()).toEqual(before);
        expect(h.fetchCalls()).toBe(0);
        console.info(
          "ADAPTER_METHOD_SETTLEMENT",
          JSON.stringify({
            method,
            ...progress,
            physicalEqual: true,
            fetchCalls: 0,
          }),
        );
      } catch (error) {
        if (!failed) throw error;
        console.info("ADAPTER_METHOD_INSPECTION_FAILED");
      }
    }
  },
);

it.each(identities)(
  "ADAPTER-IDENTITY changed %s refuses before RPC",
  async (identity) => {
    const h = await codecFixture();
    let refused = 0;
    const host = {
      run: actionGeneric({
        args: { operationId: v.string() },
        handler: async (ctx, args) => {
          const direct = await ctx.runQuery(
            refs.queries.loadAuthorizedOperation,
            args,
          );
          expect(direct?.recordJSON).toBe(h.recordJSON);
          const journal = await createActionOperationJournal(
            ctx,
            components.betterStripe,
            args.operationId,
          );
          const receiver = identity === "getFunctionMetadata" ? ctx.meta : ctx;
          const original = Object.getOwnPropertyDescriptor(receiver, identity);
          assert(
            original &&
              "value" in original &&
              typeof original.value === "function",
          );
          let replacementCalls = 0;
          Object.defineProperty(receiver, identity, {
            ...original,
            value: () => {
              replacementCalls++;
              throw Error("RETARGETED_METHOD_CALLED");
            },
          });
          try {
            await expect(journal.loadAuthorizedOperation()).rejects.toThrow(
              /^OPERATION_JOURNAL_ACTION_UNBOUND$/,
            );
            refused++;
            expect(replacementCalls).toBe(0);
          } finally {
            Object.defineProperty(receiver, identity, original);
          }
          expect(await journal.loadAuthorizedOperation()).toEqual(direct);
          return null;
        },
      }),
    };
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./adapterMethods.ts": async () => host,
    });
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/adapterMethodsInspection.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(
        inspectionRefs.betterStripe.adapterMethodsInspection.physical,
        {},
      );
    const created = await t.mutation(refs.mutations.createAuthorizedOperation, {
      authorizationScope: h.record.authorization.scope,
      authorizationRevision: h.record.authorization.revision,
      logicalOperationId: h.record.logicalOperationId,
      recordJSON: h.recordJSON,
    });
    assert(created.status === "created");
    const before = await physical();
    let failed = false;
    try {
      await t.action(call, { operationId: created.operationId });
      expect(refused).toBe(1);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        expect(await physical()).toEqual(before);
        expect(h.fetchCalls()).toBe(0);
      } catch (error) {
        if (!failed) throw error;
        console.info("ADAPTER_IDENTITY_INSPECTION_FAILED");
      }
    }
  },
);

it("ADAPTER-WRITE creates reservation, basis and event through one actual Action", async () => {
  const event = await canonicalJournalEvent(
    1,
    canonical({ future: ["whole", null] }),
  );
  const h = await codecFixture();
  const progress = { direct: 0, reserve: 0, bind: 0, append: 0 };
  const host = {
    run: actionGeneric({
      args: { operationId: v.string() },
      handler: async (ctx, args) => {
        const direct = await ctx.runQuery(
          refs.queries.loadAuthorizedOperation,
          args,
        );
        expect(direct).toEqual({
          recordVersion: 2,
          ...args,
          recordJSON: h.recordJSON,
          revision: 0,
          activeAttempt: null,
          initialBasis: null,
        });
        progress.direct++;
        const journal = await createActionOperationJournal(
          ctx,
          components.betterStripe,
          args.operationId,
        );
        const acquired = await journal.reserveAttempt({
          expectedRevision: 0,
          stage: "attach",
          expectedRequestBinding: h.record.requestBinding,
          recordJSON: h.recordJSON,
        });
        progress.reserve++;
        assert(acquired !== null && acquired.disposition === "acquired");
        expect(acquired.reservation.recordJSON).toBe(h.recordJSON);
        expect(acquired.reservation.operationId).toBe(args.operationId);
        const bound = await journal.bindInitialBasis({
          attemptId: acquired.reservation.attemptId,
          policyJSON: canonical(h.record.timingPolicy),
          basisJSON: canonical(basis),
        });
        progress.bind++;
        assert(bound !== null);
        expect(bound).toEqual({
          status: "bound",
          ...args,
          initialBasis: {
            version: 1,
            attemptId: acquired.reservation.attemptId,
            sourcePayloadId: acquired.reservation.payloadId,
            stage: "attach",
            policyJSON: canonical(h.record.timingPolicy),
            basisJSON: canonical(basis),
          },
        });
        const committed = await journal.appendStageEvent({
          reservation: acquired.reservation,
          expectedSequence: 0,
          event: { sequence: 1, binding: event.binding, dataJSON: event.json },
        });
        progress.append++;
        assert(committed !== null);
        expect(committed.reservation).toEqual(acquired.reservation);
        expect(committed).toMatchObject({
          operationId: args.operationId,
          attemptId: acquired.reservation.attemptId,
          sourcePayloadId: acquired.reservation.payloadId,
          stage: "attach",
          sequence: 1,
          binding: event.binding,
        });
        const loaded = await journal.loadAuthorizedOperation();
        assert(loaded && "recordVersion" in loaded);
        const { recordJSON: _recordJSON, ...summary } = acquired.reservation;
        expect(loaded).toEqual({
          recordVersion: 2,
          ...args,
          recordJSON: h.recordJSON,
          revision: 1,
          activeAttempt: summary,
          initialBasis: bound.initialBasis,
        });
        return null;
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./adapterMethods.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/adapterMethodsInspection.ts": async () => inspection,
  });
  const physical = async (): Promise<Physical> =>
    t.query(inspectionRefs.betterStripe.adapterMethodsInspection.physical, {});
  const created = await t.mutation(refs.mutations.createAuthorizedOperation, {
    authorizationScope: h.record.authorization.scope,
    authorizationRevision: h.record.authorization.revision,
    logicalOperationId: h.record.logicalOperationId,
    recordJSON: h.recordJSON,
  });
  assert(created.status === "created");
  const before = await physical();
  let stable = before;
  let failed = false;
  try {
    await t.action(call, { operationId: created.operationId });
    expect(progress).toEqual({ direct: 1, reserve: 1, bind: 1, append: 1 });
    const after = await physical();
    expect({
      operations: after.operations.length,
      attempts: after.attempts.length,
      events: after.events.length,
      payloads: after.payloads.length,
    }).toEqual({ operations: 1, attempts: 1, events: 1, payloads: 2 });
    expect(after.operations[0]).toMatchObject({
      _id: created.operationId,
      state: "RESERVED",
      revision: 1,
    });
    expect(after.attempts[0].lastSequence).toBe(1);
    expect(
      after.payloads.find((row) => row._id === before.payloads[0]._id),
    ).toEqual(before.payloads[0]);
    const added = after.payloads.filter(
      (row) => row._id !== before.payloads[0]._id,
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toEqual({
      _id: after.events[0].payloadId,
      _creationTime: added[0]._creationTime,
      codecVersion: 1,
      json: event.json,
      owner: {
        kind: "event",
        operationId: created.operationId,
        attemptId: after.attempts[0]._id,
        stage: "attach",
        sequence: 1,
      },
    });
    for (const rows of Object.values(after))
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    stable = after;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(stable);
      expect(h.fetchCalls()).toBe(0);
      console.info(
        "ADAPTER_WRITE_SETTLEMENT",
        JSON.stringify({ ...progress, physicalEqual: true, fetchCalls: 0 }),
      );
    } catch (error) {
      if (!failed) throw error;
      console.info("ADAPTER_WRITE_INSPECTION_FAILED");
    }
  }
});
