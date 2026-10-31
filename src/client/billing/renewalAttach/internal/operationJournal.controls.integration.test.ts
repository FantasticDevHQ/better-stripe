import assert from "node:assert/strict";
import { components } from "../../../../../example/convex/_generated/api.js";
import { createActionOperationJournal } from "./operationJournal.js";
import { convexTest } from "convex-test";
import {
  actionGeneric,
  mutationGeneric,
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
  canonical,
  codecFixture,
  VALUE_LIMIT,
} from "../../../../component/renewalOperations/timingPolicy.fixtures.js";

const refs = components.betterStripe.renewalOperations;
const nested = componentsGeneric();
type Loaded = FunctionReturnType<typeof refs.queries.loadAuthorizedOperation>;
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
      payloads: await ctx.db.query("renewalOperationPayloads").take(6),
    }),
  }),
};
const mutationTarget = makeFunctionReference<
  "mutation",
  { operationId: string },
  null
>("adapterControls:mutationContext");
const concurrentTarget = makeFunctionReference<
  "action",
  { operationId: string },
  { before: Loaded; acquired: Reserved; after: Loaded }
>("adapterControls:concurrent");

afterEach(() => vi.unstubAllGlobals());

it("ADAPTER-CONTEXT refuses a genuine registered Mutation context", async () => {
  const h = await codecFixture();
  const progress = { entered: 0, direct: 0, refused: 0 };
  const host = {
    mutationContext: mutationGeneric({
      args: { operationId: v.string() },
      handler: async (ctx, args): Promise<null> => {
        progress.entered++;
        expect(await ctx.meta.getFunctionMetadata()).toEqual({
          name: "adapterControls:mutationContext",
          componentPath: "",
          type: "mutation",
          visibility: "public",
        });
        expect(
          await ctx.runQuery(refs.queries.loadAuthorizedOperation, args),
        ).toEqual({
          recordVersion: 2,
          ...args,
          recordJSON: h.recordJSON,
          revision: 0,
          activeAttempt: null,
          initialBasis: null,
        });
        progress.direct++;
        // Deliberate runtime bad-context call using the actual registered ctx.
        // No context/metadata/reference cast or replacement is introduced.
        await expect(
          Reflect.apply(createActionOperationJournal, undefined, [
            ctx,
            components.betterStripe,
            args.operationId,
          ]),
        ).rejects.toThrow(/^OPERATION_JOURNAL_ACTION_UNBOUND$/);
        progress.refused++;
        return null;
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./adapterControls.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/adapterControlsInspection.ts": async () => inspection,
  });
  const physical = async (): Promise<Physical> =>
    t.query(nested.betterStripe.adapterControlsInspection.physical, {});
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
  const before = await physical();
  expect(before.operations).toHaveLength(1);
  expect(before.attempts).toEqual([]);
  expect(before.events).toEqual([]);
  expect(before.payloads).toHaveLength(1);
  expect(before.operations[0]).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    state: "PREPARED",
    revision: 0,
    payloadId: before.payloads[0]._id,
  });
  expect(before.payloads[0]).toMatchObject({
    codecVersion: 1,
    json: h.recordJSON,
    owner: { kind: "operation", operationId: created.operationId },
  });
  for (const rows of Object.values(before))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  let failed = false;
  try {
    expect(
      await t.mutation(mutationTarget, { operationId: created.operationId }),
    ).toBeNull();
    expect(progress).toEqual({ entered: 1, direct: 1, refused: 1 });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
      console.info(
        "ADAPTER_CONTEXT_SETTLEMENT",
        JSON.stringify({ ...progress, physicalEqual: true, fetchCalls: 0 }),
      );
    } catch (error) {
      if (!failed) throw error;
      console.info("ADAPTER_CONTEXT_INSPECTION_FAILED");
    }
  }
});

it("ADAPTER-CONCURRENT keeps two genuine Action facades operation-bound", async () => {
  const h = await codecFixture();
  const records = [
    h.recordJSON,
    canonical({
      ...h.record,
      logicalOperationId: h.record.logicalOperationId + "-concurrent",
    }),
  ];
  const logicalOperationIds = [
    h.record.logicalOperationId,
    h.record.logicalOperationId + "-concurrent",
  ];
  const expectedRecords = new Map<string, string>();
  let captured = 0;
  let releaseBoth = () => {};
  const bothCaptured = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const host = {
    concurrent: actionGeneric({
      args: { operationId: v.string() },
      handler: async (
        ctx,
        args,
      ): Promise<FunctionReturnType<typeof concurrentTarget>> => {
        expect(await ctx.meta.getFunctionMetadata()).toEqual({
          name: "adapterControls:concurrent",
          componentPath: "",
          type: "action",
          visibility: "public",
        });
        const recordJSON = expectedRecords.get(args.operationId);
        assert(recordJSON);
        const journal = await createActionOperationJournal(
          ctx,
          components.betterStripe,
          args.operationId,
        );
        captured++;
        if (captured === 2) releaseBoth();
        await Promise.race([bothCaptured, barrierTimeout]);
        const before = await journal.loadAuthorizedOperation();
        expect(before).toEqual({
          recordVersion: 2,
          ...args,
          recordJSON,
          revision: 0,
          activeAttempt: null,
          initialBasis: null,
        });
        const acquired = await journal.reserveAttempt({
          expectedRevision: 0,
          stage: "attach",
          expectedRequestBinding: h.record.requestBinding,
          recordJSON,
        });
        assert(acquired.disposition === "acquired");
        expect(acquired.reservation.operationId).toBe(args.operationId);
        expect(acquired.reservation.recordJSON).toBe(recordJSON);
        const { recordJSON: _recordJSON, ...summary } = acquired.reservation;
        const after = await journal.loadAuthorizedOperation();
        expect(after).toEqual({
          recordVersion: 2,
          ...args,
          recordJSON,
          revision: 1,
          activeAttempt: summary,
          initialBasis: null,
        });
        expect(getConvexSize({ before, acquired, after })).toBeLessThanOrEqual(
          VALUE_LIMIT,
        );
        return { before, acquired, after };
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./adapterControls.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/adapterControlsInspection.ts": async () => inspection,
  });
  const physical = async (): Promise<Physical> =>
    t.query(nested.betterStripe.adapterControlsInspection.physical, {});
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const operationIds: string[] = [];
  for (const [index, recordJSON] of records.entries()) {
    const created = await t.mutation(refs.mutations.createAuthorizedOperation, {
      authorizationScope: h.record.authorization.scope,
      authorizationRevision: h.record.authorization.revision,
      logicalOperationId: logicalOperationIds[index],
      recordJSON,
    });
    assert(created.status === "created");
    operationIds.push(created.operationId);
    expectedRecords.set(created.operationId, recordJSON);
  }
  expect(new Set(operationIds).size).toBe(2);
  const before = await physical();
  expect(before.operations).toHaveLength(2);
  expect(before.attempts).toEqual([]);
  expect(before.events).toEqual([]);
  expect(before.payloads).toHaveLength(2);
  let stable = before;
  let failed = false;
  const barrierTimeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(
      () => reject(Error("ADAPTER_CONCURRENT_CAPTURE_PREREQUISITE_STOP")),
      1000,
    );
  });
  try {
    const settled = await Promise.allSettled(
      operationIds.map((operationId) =>
        t.action(concurrentTarget, { operationId }),
      ),
    );
    const results = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect(settled.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(captured).toBe(2);
    const attempts = new Set<string>();
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      assert(result.acquired.disposition === "acquired");
      expect(result.before?.operationId).toBe(operationIds[index]);
      expect(result.before?.recordJSON).toBe(records[index]);
      expect(result.after?.operationId).toBe(operationIds[index]);
      expect(result.after?.recordJSON).toBe(records[index]);
      attempts.add(result.acquired.reservation.attemptId);
    }
    expect(attempts.size).toBe(2);
    const after = await physical();
    expect(after.operations).toHaveLength(2);
    expect(after.attempts).toHaveLength(2);
    expect(after.events).toEqual([]);
    expect(after.payloads).toEqual(before.payloads);
    for (const original of before.operations) {
      const result = results.find(
        (value) => value.after?.operationId === original._id,
      );
      assert(result && result.acquired.disposition === "acquired");
      const reservation = result.acquired.reservation;
      expect(after.operations.find((row) => row._id === original._id)).toEqual({
        ...original,
        revision: 1,
        state: "RESERVED",
        activeAttemptId: reservation.attemptId,
      });
      expect(
        after.attempts.find((row) => row._id === reservation.attemptId),
      ).toMatchObject({
        operationId: original._id,
        payloadId: reservation.payloadId,
        lastSequence: 0,
      });
    }
    for (const rows of Object.values(after))
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    stable = after;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    try {
      expect(await physical()).toEqual(stable);
      expect(h.fetchCalls()).toBe(0);
      console.info(
        "ADAPTER_CONCURRENT_SETTLEMENT",
        JSON.stringify({ captured, physicalEqual: true, fetchCalls: 0 }),
      );
    } catch (error) {
      if (!failed) throw error;
      console.info("ADAPTER_CONCURRENT_INSPECTION_FAILED");
    }
  }
});
