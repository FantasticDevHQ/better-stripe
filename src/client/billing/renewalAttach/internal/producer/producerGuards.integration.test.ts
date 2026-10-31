import assert from "node:assert/strict";
import { BetterStripe } from "../../../../index.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { captureMaintainedActionSelection } from "./classOwnedActionRoot.js";
import {
  createClassActionOperationJournal,
  consumeClassReservation,
} from "../operationJournal.js";
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
import { modules, schema } from "../../../../../test.js";
import { query } from "../../../../../component/_generated/server.js";
import type { Doc } from "../../../../../component/_generated/dataModel.js";
import {
  canonical,
  codecFixture,
  VALUE_LIMIT,
} from "../../../../../component/renewalOperations/timingPolicy.fixtures.js";
const refs = components.betterStripe.renewalOperations;
const nested = componentsGeneric();
const route = makeFunctionReference<"action", { operationId: string }, null>(
  "winningConcurrent:run",
);
type Reserved = FunctionReturnType<typeof refs.mutations.reserveAttempt>;
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
      events: await ctx.db.query("renewalOperationEvents").take(4),
      payloads: await ctx.db.query("renewalOperationPayloads").take(5),
    }),
  }),
};
afterEach(() => vi.unstubAllGlobals());

it("WINNING-CONCURRENT isolates two actual Action call handles on one SDK", async () => {
  const h = await codecFixture();
  const logicalIds = [
    h.record.logicalOperationId,
    h.record.logicalOperationId + "-winning-concurrent",
  ];
  const records = [
    h.recordJSON,
    canonical({ ...h.record, logicalOperationId: logicalIds[1] }),
  ];
  const sdk = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_invalid_winning_concurrent",
  });
  const descriptor = Object.getOwnPropertyDescriptor(sdk, "_apiKey");
  assert(descriptor && "value" in descriptor && descriptor.configurable);
  let selectorReads = 0;
  Object.defineProperty(sdk, "_apiKey", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      selectorReads++;
      throw Error("CONCURRENT_SELECTOR_TOUCHED");
    },
  });
  try {
    const expected = new Map<string, string>();
    const replies: Reserved[] = [];
    const tags = new Set<object>();
    const calls = new Set<object>();
    let captured = 0;
    let release = () => {};
    const bothCaptured = new Promise<void>((resolve) => {
      release = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const host = {
      run: actionGeneric({
        args: { operationId: v.string() },
        handler: async (ctx, args): Promise<null> => {
          expect(await ctx.meta.getFunctionMetadata()).toEqual({
            name: "winningConcurrent:run",
            componentPath: "",
            type: "action",
            visibility: "public",
          });
          const recordJSON = expected.get(args.operationId);
          assert(recordJSON);
          expect(
            await ctx.runQuery(refs.queries.loadAuthorizedOperation, args),
          ).toEqual({
            recordVersion: 2,
            ...args,
            recordJSON,
            revision: 0,
            activeAttempt: null,
            initialBasis: null,
          });
          await expect(
            captureMaintainedActionSelection(sdk, {
              actualActionCtx: ctx,
              operationId: args.operationId,
            }),
          ).rejects.toThrow(/^CLASS_ACTION_PROFILE_UNBOUND$/);
          const journal = await createClassActionOperationJournal(sdk, {
            actualActionCtx: ctx,
            operationId: args.operationId,
          });
          expect((await journal.loadAuthorizedOperation())?.recordJSON).toBe(
            recordJSON,
          );
          captured++;
          if (captured === 2) release();
          await Promise.race([bothCaptured, timeout]);
          const fresh = await journal.reserveFreshAttempt({
            expectedRevision: 0,
            stage: "attach",
            expectedRequestBinding: h.record.requestBinding,
            recordJSON,
          });
          assert(fresh.result.disposition === "acquired");
          replies.push(fresh.result);
          const reservation = fresh.result.reservation;
          expect(reservation.operationId).toBe(args.operationId);
          expect(reservation.recordJSON).toBe(recordJSON);
          expect(
            await ctx.runQuery(refs.queries.readAttempt, {
              ...args,
              attemptId: reservation.attemptId,
            }),
          ).toEqual({ reservation, events: [] });
          expect(getConvexSize(fresh.result)).toBeLessThanOrEqual(VALUE_LIMIT);
          expect(fresh.call).not.toBeNull();
          assert(fresh.call !== null);
          const call = fresh.call;
          calls.add(call);
          const consumed = consumeClassReservation(call, journal);
          expect(consumed.reservation).toBe(reservation);
          tags.add(consumed.tag);
          expect(() => consumeClassReservation(call, journal)).toThrow(
            /^CLASS_JOURNAL_CALL_UNBOUND$/,
          );
          expect(selectorReads).toBe(0);
          return null;
        },
      }),
    };
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./winningConcurrent.ts": async () => host,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        modules,
        "./component/winningConcurrentInspection.ts",
      ),
    ).toBe(false);
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/winningConcurrentInspection.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(nested.betterStripe.winningConcurrentInspection.physical, {});
    expect(await physical()).toEqual({
      operations: [],
      attempts: [],
      events: [],
      payloads: [],
    });
    const ids: string[] = [];
    for (let index = 0; index < records.length; index++) {
      const created = await t.mutation(
        refs.mutations.createAuthorizedOperation,
        {
          authorizationScope: h.record.authorization.scope,
          authorizationRevision: h.record.authorization.revision,
          logicalOperationId: logicalIds[index],
          recordJSON: records[index],
        },
      );
      assert(created.status === "created");
      ids.push(created.operationId);
      expected.set(created.operationId, records[index]);
    }
    expect(new Set(ids).size).toBe(2);
    const before = await physical();
    expect({
      operations: before.operations.length,
      attempts: before.attempts.length,
      events: before.events.length,
      payloads: before.payloads.length,
    }).toEqual({ operations: 2, attempts: 0, events: 0, payloads: 2 });
    for (const operation of before.operations) {
      expect(operation).toMatchObject({
        recordVersion: 2,
        state: "PREPARED",
        revision: 0,
      });
      const source = before.payloads.find(
        (row) => row._id === operation.payloadId,
      );
      assert(source);
      expect(source.json).toBe(expected.get(operation._id));
      expect(source.owner).toEqual({
        kind: "operation",
        operationId: operation._id,
      });
    }
    let stable = before;
    let failed = false;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Error("WINNING_CONCURRENT_CAPTURE_STOP")),
        1000,
      );
    });
    try {
      const settled = await Promise.allSettled(
        ids.map((operationId) => t.action(route, { operationId })),
      );
      const originalFailure = settled.find(
        (result) => result.status === "rejected",
      );
      try {
        const after = await physical();
        expect(after.operations).toHaveLength(2);
        expect(after.attempts).toHaveLength(replies.length);
        expect(after.events).toEqual([]);
        expect(after.payloads).toEqual(before.payloads);
        for (const original of before.operations) {
          const reply = replies.find(
            (result) =>
              result.disposition === "acquired" &&
              result.reservation.operationId === original._id,
          );
          if (!reply) {
            expect(
              after.operations.find((row) => row._id === original._id),
            ).toEqual(original);
            continue;
          }
          assert(reply.disposition === "acquired");
          const reservation = reply.reservation;
          expect(
            after.operations.find((row) => row._id === original._id),
          ).toEqual({
            ...original,
            state: "RESERVED",
            revision: 1,
            activeAttemptId: reservation.attemptId,
          });
          const actualAttempt = after.attempts.find(
            (row) => row._id === reservation.attemptId,
          );
          assert(actualAttempt);
          const { attemptId, recordJSON: _recordJSON, ...fields } = reservation;
          expect(actualAttempt).toEqual({
            ...fields,
            _id: attemptId,
            _creationTime: actualAttempt._creationTime,
            lastSequence: 0,
          });
        }
        for (const rows of Object.values(after))
          for (const row of rows)
            expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
        stable = after;
      } catch (error) {
        if (originalFailure?.status === "rejected") {
          console.info("WINNING_CONCURRENT_INSPECTION_FAILED");
          throw originalFailure.reason;
        }
        throw error;
      }
      if (originalFailure?.status === "rejected") throw originalFailure.reason;
      expect(settled.map((result) => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
      expect(captured).toBe(2);
      expect(replies).toHaveLength(2);
      expect(calls.size).toBe(2);
      expect(tags.size).toBe(2);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        expect(await physical()).toEqual(stable);
        expect(selectorReads).toBe(0);
        expect(h.fetchCalls()).toBe(0);
        console.info(
          "WINNING_CONCURRENT_SETTLEMENT",
          JSON.stringify({
            captured,
            replies: replies.length,
            calls: calls.size,
            tags: tags.size,
            physicalEqual: true,
            selectorReads,
            fetchCalls: 0,
          }),
        );
      } catch (error) {
        if (!failed) throw error;
        console.info("WINNING_CONCURRENT_FINAL_INSPECTION_FAILED");
      }
    }
  } finally {
    Object.defineProperty(sdk, "_apiKey", descriptor);
  }
});
