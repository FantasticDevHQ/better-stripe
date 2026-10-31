import assert from "node:assert/strict";
import { components } from "../../../../../example/convex/_generated/api.js";
import { createActionOperationJournal } from "./operationJournal.js";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  componentsGeneric,
  defineSchema,
  makeFunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { getConvexSize, getDocumentSize, v } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../../../test.js";
import { query } from "../../../../component/_generated/server.js";
import type { Doc } from "../../../../component/_generated/dataModel.js";
import {
  prepareV2AcknowledgementScenario,
  canonical,
  VALUE_LIMIT,
} from "../../../../component/renewalOperations/acknowledgement.fixtures.js";
import { canonicalJournalEvent } from "../../../../shared/renewalOperationJournal.js";

const refs = components.betterStripe.renewalOperations;
const nested = componentsGeneric();
type Retained = FunctionReturnType<
  typeof refs.mutations.retainProviderAcknowledgement
>;
type Read = FunctionReturnType<typeof refs.queries.readProviderAcknowledgement>;
const target = makeFunctionReference<
  "action",
  { operationId: string },
  { retained: Retained | null; read: Read }
>("adapterAcknowledgement:run");
const scenarios = ["retain-duplicate", "read", "retain-first"] as const;
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
      payloads: await ctx.db.query("renewalOperationPayloads").take(6),
    }),
  }),
};
afterEach(() => vi.unstubAllGlobals());

it.each(scenarios)(
  "ADAPTER-ACK %s preserves complete owned C3 DATA",
  async (scenario) => {
    const basis = {
      startWallMs: 1700000001000,
      startNsDecimal: "1000000000",
      workEndWallMs: 1700000005000,
      workEndNsDecimal: "5000000000",
      endWallMs: 1700000006000,
      endNsDecimal: "6000000000",
    };
    // Maintained offline pure C3/whole-output/capture fixture, not runtime custody.
    // Its DB rows/IDs are never copied into the fresh mounted operation below.
    const h = await prepareV2AcknowledgementScenario();
    expect(h.shouldRetain).toBe(true);
    expect(h.scenario).toBe("clean");
    const recordJSON = h.acquired.reservation.recordJSON;
    const declared = JSON.parse(recordJSON);
    expect(declared.schemaVersion).toBe(2);
    expect(declared.attachRequest).toEqual(h.raw.attachRequest);
    expect(declared.dispatch).toEqual(h.raw.actualDispatch);
    expect(Object.keys(declared.dispatch)).toHaveLength(7);
    expect(canonical(h.receipt)).toBe(h.receiptJSON);
    const declaredEvents: Awaited<ReturnType<typeof canonicalJournalEvent>>[] =
      [];
    for (const committed of h.commits) {
      const payload = h.before.payloads.find(
        (row) => row._id === committed.payloadId,
      );
      assert(payload);
      const event = await canonicalJournalEvent(
        committed.sequence,
        payload.json,
      );
      expect(event.binding).toBe(committed.binding);
      expect(event.json).toBe(payload.json);
      declaredEvents.push(event);
    }
    expect(declaredEvents.map((event) => event.sequence)).toEqual([1, 2]);
    const progress = { direct: 0, capture: 0, target: 0 };
    const host = {
      run: actionGeneric({
        args: { operationId: v.string() },
        handler: async (
          ctx,
          args,
        ): Promise<FunctionReturnType<typeof target>> => {
          expect(await ctx.meta.getFunctionMetadata()).toEqual({
            name: "adapterAcknowledgement:run",
            componentPath: "",
            type: "action",
            visibility: "public",
          });
          const loaded = await ctx.runQuery(
            refs.queries.loadAuthorizedOperation,
            args,
          );
          assert(
            loaded && "recordVersion" in loaded && loaded.recordVersion === 2,
          );
          expect(loaded.recordJSON).toBe(recordJSON);
          expect(loaded.initialBasis).toEqual(bound.initialBasis);
          expect(
            await ctx.runQuery(
              nested.betterStripe.adapterAcknowledgementInspection.physical,
              {},
            ),
          ).toEqual(before);
          const direct = await ctx.runQuery(
            refs.queries.readProviderAcknowledgement,
            args,
          );
          expect(direct).toEqual(
            scenario === "retain-first"
              ? null
              : { retention: originalRetained, receiptJSON: h.receiptJSON },
          );
          progress.direct++;
          const journal = await createActionOperationJournal(
            ctx,
            components.betterStripe,
            args.operationId,
          );
          progress.capture++;
          if (scenario === "read") {
            const read = await journal.readProviderAcknowledgement();
            progress.target++;
            expect(read).toEqual(direct);
            return { retained: originalRetained, read };
          }
          const retained = await journal.retainProviderAcknowledgement({
            attemptId: reservation.attemptId,
            expectedSequence: 2,
            receiptJSON: h.receiptJSON,
          });
          progress.target++;
          if (scenario === "retain-duplicate")
            expect(retained).toEqual(originalRetained);
          else expect(retained).toMatchObject({ status: "retained", ...args });
          assert(retained !== null);
          const read = await ctx.runQuery(
            refs.queries.readProviderAcknowledgement,
            args,
          );
          expect(read).toEqual({
            retention: retained,
            receiptJSON: h.receiptJSON,
          });
          return { retained, read };
        },
      }),
    };
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./adapterAcknowledgement.ts": async () => host,
    });
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/adapterAcknowledgementInspection.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(
        nested.betterStripe.adapterAcknowledgementInspection.physical,
        {},
      );
    expect(await physical()).toEqual({
      operations: [],
      attempts: [],
      events: [],
      payloads: [],
    });
    const sourceOperation = h.before.operations[0];
    const created = await t.mutation(refs.mutations.createAuthorizedOperation, {
      authorizationScope: sourceOperation.authorizationScope,
      logicalOperationId: sourceOperation.logicalOperationId,
      authorizationRevision: sourceOperation.authorizationRevision,
      recordJSON,
    });
    assert(created.status === "created");
    const args = { operationId: created.operationId };
    const acquired = await t.mutation(refs.mutations.reserveAttempt, {
      ...args,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: h.acquired.reservation.requestBinding,
      recordJSON,
    });
    assert(acquired.disposition === "acquired");
    const reservation = acquired.reservation;
    expect(reservation.recordJSON).toBe(recordJSON);
    const bound = await t.mutation(refs.mutations.bindInitialBasis, {
      ...args,
      attemptId: reservation.attemptId,
      policyJSON: canonical(declared.timingPolicy),
      basisJSON: canonical(basis),
    });
    const commits: FunctionReturnType<
      typeof refs.mutations.appendStageEvent
    >[] = [];
    for (const event of declaredEvents) {
      const committed = await t.mutation(refs.mutations.appendStageEvent, {
        reservation,
        expectedSequence: event.sequence - 1,
        event: {
          sequence: event.sequence,
          binding: event.binding,
          dataJSON: event.json,
        },
      });
      expect(committed.reservation).toEqual(reservation);
      commits.push(committed);
    }
    const owned = await physical();
    expect({
      operations: owned.operations.length,
      attempts: owned.attempts.length,
      events: owned.events.length,
      payloads: owned.payloads.length,
    }).toEqual({ operations: 1, attempts: 1, events: 2, payloads: 3 });
    expect(owned.operations[0].initialBasis).toEqual(bound.initialBasis);
    expect(owned.attempts[0].lastSequence).toBe(2);
    expect(owned.operations[0].knownAcknowledgement).toBeUndefined();
    const source = owned.payloads.find(
      (row) => row._id === reservation.payloadId,
    );
    assert(source);
    expect(source.json).toBe(recordJSON);
    expect(source.owner).toEqual({ kind: "operation", ...args });
    for (let index = 0; index < commits.length; index++) {
      const commit = commits[index];
      const row = owned.events.find((event) => event._id === commit.eventId);
      assert(row);
      expect(row).toEqual({
        _id: commit.eventId,
        _creationTime: row._creationTime,
        operationId: created.operationId,
        attemptId: reservation.attemptId,
        sourcePayloadId: reservation.payloadId,
        stage: "attach",
        sequence: commit.sequence,
        binding: commit.binding,
        payloadId: commit.payloadId,
      });
      const payload = owned.payloads.find(
        (row) => row._id === commit.payloadId,
      );
      assert(payload);
      expect(payload).toEqual({
        _id: commit.payloadId,
        _creationTime: payload._creationTime,
        codecVersion: 1,
        json: declaredEvents[index].json,
        owner: {
          kind: "event",
          ...args,
          attemptId: reservation.attemptId,
          stage: "attach",
          sequence: commit.sequence,
        },
      });
    }
    const retainArgs = {
      ...args,
      attemptId: reservation.attemptId,
      expectedSequence: 2 as const,
      receiptJSON: h.receiptJSON,
    };
    expect(getConvexSize(retainArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    const originalRetained: Retained | null =
      scenario === "retain-first"
        ? null
        : await t.mutation(
            refs.mutations.retainProviderAcknowledgement,
            retainArgs,
          );
    const before = await physical();
    let stable = before;
    let failed = false;
    try {
      const result = await t.action(target, args);
      expect(progress).toEqual({ direct: 1, capture: 1, target: 1 });
      assert(result.retained !== null);
      const retained = result.retained;
      const known = {
        schemaVersion: 1,
        stage: "attach",
        attemptId: reservation.attemptId,
        sourcePayloadId: reservation.payloadId,
        dispatchEventId: commits[0].eventId,
        dispatchPayloadId: commits[0].payloadId,
        responseEventId: commits[1].eventId,
        responsePayloadId: commits[1].payloadId,
        receiptPayloadId: retained.receiptPayloadId,
        receiptBinding: h.receipt.binding,
      };
      expect(retained).toEqual({ status: "retained", ...args, ...known });
      expect(result.read).toEqual({
        retention: retained,
        receiptJSON: h.receiptJSON,
      });
      const after = await physical();
      expect({
        operations: after.operations.length,
        attempts: after.attempts.length,
        events: after.events.length,
        payloads: after.payloads.length,
      }).toEqual({ operations: 1, attempts: 1, events: 2, payloads: 4 });
      expect(after.operations).toEqual([
        { ...owned.operations[0], knownAcknowledgement: known },
      ]);
      expect(after.attempts).toEqual(owned.attempts);
      expect(after.events).toEqual(owned.events);
      for (const original of owned.payloads)
        expect(after.payloads.find((row) => row._id === original._id)).toEqual(
          original,
        );
      const receiptPayload = after.payloads.find(
        (row) => row._id === retained.receiptPayloadId,
      );
      assert(receiptPayload);
      expect(receiptPayload).toEqual({
        _id: retained.receiptPayloadId,
        _creationTime: receiptPayload._creationTime,
        codecVersion: 1,
        json: h.receiptJSON,
        owner: {
          kind: "receipt",
          ...args,
          attemptId: reservation.attemptId,
          stage: "attach",
        },
      });
      expect(after.events.some((row) => row.sequence === 3)).toBe(false);
      if (scenario !== "retain-first") expect(after).toEqual(before);
      for (const rows of Object.values(after))
        for (const row of rows)
          expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
      expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
      stable = after;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        expect(await physical()).toEqual(stable);
        expect(h.fetchCalls()).toBe(0);
        console.info(
          "ADAPTER_ACK_SETTLEMENT",
          JSON.stringify({
            scenario,
            ...progress,
            physicalEqual: true,
            fetchCalls: 0,
          }),
        );
      } catch (error) {
        if (!failed) throw error;
        console.info("ADAPTER_ACK_INSPECTION_FAILED");
      }
    }
  },
);

it.each(["extra-operation", "foreign-reservation"] as const)(
  "ADAPTER-SCOPE %s refuses without modifying either real operation",
  async (mode) => {
    const h = await prepareV2AcknowledgementScenario();
    const original = JSON.parse(h.acquired.reservation.recordJSON);
    const foreignJSON = canonical({
      ...original,
      logicalOperationId: original.logicalOperationId + "-foreign",
    });
    const host = {
      run: actionGeneric({
        args: { operationId: v.string() },
        handler: async (
          ctx,
          args,
        ): Promise<FunctionReturnType<typeof target>> => {
          const direct = await ctx.runQuery(
            refs.queries.loadAuthorizedOperation,
            args,
          );
          expect(direct?.recordJSON).toBe(h.acquired.reservation.recordJSON);
          expect(
            (
              await ctx.runQuery(refs.queries.loadAuthorizedOperation, {
                operationId: foreignOperationId,
              })
            )?.recordJSON,
          ).toBe(foreignJSON);
          const journal = await createActionOperationJournal(
            ctx,
            components.betterStripe,
            args.operationId,
          );
          if (mode === "extra-operation") {
            const input = {
              operationId: foreignOperationId,
              expectedRevision: 0,
              stage: "attach" as const,
              expectedRequestBinding: original.requestBinding,
              recordJSON: foreignJSON,
            };
            await expect(journal.reserveAttempt(input)).rejects.toThrow(
              /^OPERATION_JOURNAL_ACTION_UNBOUND$/,
            );
          } else {
            const input = {
              reservation,
              expectedSequence: 0,
              event: {
                sequence: 1 as const,
                binding: event.binding,
                dataJSON: event.json,
              },
            };
            await expect(journal.appendStageEvent(input)).rejects.toThrow(
              /^OPERATION_JOURNAL_ACTION_UNBOUND$/,
            );
          }
          return { retained: null, read: null };
        },
      }),
    };
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./adapterAcknowledgement.ts": async () => host,
    });
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/adapterAcknowledgementInspection.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(
        nested.betterStripe.adapterAcknowledgementInspection.physical,
        {},
      );
    const createInput = {
      authorizationScope: original.authorization.scope,
      authorizationRevision: original.authorization.revision,
      logicalOperationId: original.logicalOperationId,
      recordJSON: h.acquired.reservation.recordJSON,
    };
    const created = await t.mutation(
      refs.mutations.createAuthorizedOperation,
      createInput,
    );
    const foreign = await t.mutation(refs.mutations.createAuthorizedOperation, {
      ...createInput,
      logicalOperationId: original.logicalOperationId + "-foreign",
      recordJSON: foreignJSON,
    });
    assert(created.status === "created" && foreign.status === "created");
    const foreignOperationId = foreign.operationId;
    const acquired = await t.mutation(refs.mutations.reserveAttempt, {
      operationId: foreignOperationId,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: original.requestBinding,
      recordJSON: foreignJSON,
    });
    assert(acquired.disposition === "acquired");
    const reservation = acquired.reservation;
    const event = await canonicalJournalEvent(
      1,
      canonical({ independent: "scope-refusal" }),
    );
    const before = await physical();
    let failed = false;
    try {
      await t.action(target, { operationId: created.operationId });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        expect(await physical()).toEqual(before);
        expect(h.fetchCalls()).toBe(0);
      } catch (error) {
        if (!failed) throw error;
        console.info("ADAPTER_SCOPE_INSPECTION_FAILED");
      }
    }
  },
);
