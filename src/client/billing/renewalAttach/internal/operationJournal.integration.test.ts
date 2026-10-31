import { components as generatedComponents } from "../../../../../example/convex/_generated/api.js";
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
import {
  getConvexSize,
  getDocumentSize,
  v,
  type ObjectType,
} from "convex/values";
import { afterEach, expect, it, vi } from "vitest";
import { modules, schema } from "../../../../test.js";
import { query as componentQuery } from "../../../../component/_generated/server.js";
import type { Doc } from "../../../../component/_generated/dataModel.js";
import {
  creationArgs,
  reserveArgs,
} from "../../../../component/renewalOperations/schema.js";
import {
  canonical,
  codecFixture,
  VALUE_LIMIT,
} from "../../../../component/renewalOperations/timingPolicy.fixtures.js";

// TEST-only mounted references; never a production ComponentApi substitute.
const nested = componentsGeneric();
const createAction = makeFunctionReference<
  "action",
  ObjectType<typeof creationArgs>,
  null
>("host:createAction");
const createMutation = makeFunctionReference<
  "mutation",
  ObjectType<typeof creationArgs>,
  null
>("host:createMutation");
const reserveAction = makeFunctionReference<
  "action",
  ObjectType<typeof reserveArgs>,
  null
>("host:reserveAction");
const reserveMutation = makeFunctionReference<
  "mutation",
  ObjectType<typeof reserveArgs>,
  null
>("host:reserveMutation");
const cases = [
  { phase: "create", parent: "action", route: "host:createAction" },
  { phase: "create", parent: "mutation", route: "host:createMutation" },
  { phase: "reserve", parent: "action", route: "host:reserveAction" },
  { phase: "reserve", parent: "mutation", route: "host:reserveMutation" },
] as const;
type Physical = {
  operations: Doc<"renewalOperations">[];
  attempts: Doc<"renewalOperationAttempts">[];
  events: Doc<"renewalOperationEvents">[];
  payloads: Doc<"renewalOperationPayloads">[];
};
type Trace = { route: string; metadata: unknown; reply: unknown };
const parentStop = "JOURNAL_MECHANICAL_PARENT_STOP";
afterEach(() => vi.unstubAllGlobals());

it.each(cases)(
  "ACTION-MECHANICAL $phase under $parent has the declared transaction boundary",
  async (scenario) => {
    const h = await codecFixture();
    const trace: Trace[] = [];
    const host = {
      createAction: actionGeneric({
        args: creationArgs,
        handler: async (ctx, args) => {
          const metadata = await ctx.meta.getFunctionMetadata();
          expect(metadata).toEqual({
            name: "host:createAction",
            componentPath: "",
            type: "action",
            visibility: "public",
          });
          const reply: unknown = await ctx.runMutation(
            nested.betterStripe.renewalOperations.mutations
              .createAuthorizedOperation,
            args,
          );
          expect(reply).toMatchObject({ status: "created" });
          trace.push({ route: "host:createAction", metadata, reply });
          throw Error(parentStop);
        },
      }),
      createMutation: mutationGeneric({
        args: creationArgs,
        handler: async (ctx, args) => {
          const metadata = await ctx.meta.getFunctionMetadata();
          expect(metadata).toEqual({
            name: "host:createMutation",
            componentPath: "",
            type: "mutation",
            visibility: "public",
          });
          const reply: unknown = await ctx.runMutation(
            nested.betterStripe.renewalOperations.mutations
              .createAuthorizedOperation,
            args,
          );
          expect(reply).toMatchObject({ status: "created" });
          trace.push({ route: "host:createMutation", metadata, reply });
          throw Error(parentStop);
        },
      }),
      reserveAction: actionGeneric({
        args: reserveArgs,
        handler: async (ctx, args) => {
          const metadata = await ctx.meta.getFunctionMetadata();
          expect(metadata).toEqual({
            name: "host:reserveAction",
            componentPath: "",
            type: "action",
            visibility: "public",
          });
          const reply: unknown = await ctx.runMutation(
            nested.betterStripe.renewalOperations.mutations.reserveAttempt,
            args,
          );
          expect(reply).toMatchObject({
            disposition: "acquired",
            previousRevision: 0,
            committedRevision: 1,
          });
          trace.push({ route: "host:reserveAction", metadata, reply });
          throw Error(parentStop);
        },
      }),
      reserveMutation: mutationGeneric({
        args: reserveArgs,
        handler: async (ctx, args) => {
          const metadata = await ctx.meta.getFunctionMetadata();
          expect(metadata).toEqual({
            name: "host:reserveMutation",
            componentPath: "",
            type: "mutation",
            visibility: "public",
          });
          const reply: unknown = await ctx.runMutation(
            nested.betterStripe.renewalOperations.mutations.reserveAttempt,
            args,
          );
          expect(reply).toMatchObject({
            disposition: "acquired",
            previousRevision: 0,
            committedRevision: 1,
          });
          trace.push({ route: "host:reserveMutation", metadata, reply });
          throw Error(parentStop);
        },
      }),
    };
    const inspection = {
      physical: componentQuery({
        args: {},
        handler: async (ctx): Promise<Physical> => ({
          operations: await ctx.db.query("renewalOperations").take(3),
          attempts: await ctx.db.query("renewalOperationAttempts").take(3),
          events: await ctx.db.query("renewalOperationEvents").take(4),
          payloads: await ctx.db.query("renewalOperationPayloads").take(6),
        }),
      }),
    };
    // The empty host API module is only convex-test's module-root sentinel.
    // No generated file or journal function reference is fabricated by it.
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./host.ts": async () => host,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        modules,
        "./component/journalMechanical.ts",
      ),
    ).toBe(false);
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/journalMechanical.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(nested.betterStripe.journalMechanical.physical, {});
    expect(await physical()).toEqual({
      operations: [],
      attempts: [],
      events: [],
      payloads: [],
    });
    const createArgs: ObjectType<typeof creationArgs> = {
      authorizationScope: h.record.authorization.scope,
      logicalOperationId: h.record.logicalOperationId,
      authorizationRevision: h.record.authorization.revision,
      recordJSON: h.recordJSON,
    };
    expect(getConvexSize(createArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
    if (scenario.phase === "reserve") {
      const created: unknown = await t.mutation(
        nested.betterStripe.renewalOperations.mutations
          .createAuthorizedOperation,
        createArgs,
      );
      const prepared = await physical();
      expect(prepared.operations).toHaveLength(1);
      expect(prepared.payloads).toHaveLength(1);
      expect(prepared.attempts).toHaveLength(0);
      expect(prepared.events).toHaveLength(0);
      const operationId = prepared.operations[0]._id;
      expect(created).toEqual({ status: "created", operationId });
      expect(
        await t.query(
          nested.betterStripe.renewalOperations.queries.loadAuthorizedOperation,
          { operationId },
        ),
      ).toEqual({
        recordVersion: 2,
        operationId,
        recordJSON: h.recordJSON,
        revision: 0,
        activeAttempt: null,
        initialBasis: null,
      });
    }
    const before = await physical();
    const operation = before.operations[0];
    let targetFailed = false;
    let stable = before;
    try {
      if (scenario.phase === "create") {
        const operationPromise =
          scenario.parent === "action"
            ? t.action(createAction, createArgs)
            : t.mutation(createMutation, createArgs);
        await expect(operationPromise).rejects.toThrow(
          new RegExp("^" + parentStop + "$"),
        );
      } else {
        const args: ObjectType<typeof reserveArgs> = {
          operationId: operation._id,
          expectedRevision: 0,
          stage: "attach",
          expectedRequestBinding: h.record.requestBinding,
          recordJSON: h.recordJSON,
        };
        expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
        const operationPromise =
          scenario.parent === "action"
            ? t.action(reserveAction, args)
            : t.mutation(reserveMutation, args);
        await expect(operationPromise).rejects.toThrow(
          new RegExp("^" + parentStop + "$"),
        );
      }
      expect(trace).toHaveLength(1);
      expect(trace[0].route).toBe(scenario.route);
      const after = await physical();
      stable = after;
      if (scenario.parent === "mutation") {
        expect(after).toEqual(before);
      } else if (scenario.phase === "create") {
        expect({
          operations: after.operations.length,
          attempts: after.attempts.length,
          events: after.events.length,
          payloads: after.payloads.length,
        }).toEqual({ operations: 1, attempts: 0, events: 0, payloads: 1 });
        const row = after.operations[0];
        const payload = after.payloads[0];
        expect(row).toEqual({
          _id: row._id,
          _creationTime: row._creationTime,
          recordVersion: 2,
          authorizationScope: h.record.authorization.scope,
          authorizationId: h.record.authorization.id,
          authorizationRevision: h.record.authorization.revision,
          logicalOperationId: h.record.logicalOperationId,
          requestBinding: h.record.requestBinding,
          payloadId: payload._id,
          revision: 0,
          state: "PREPARED",
        });
        expect(payload).toEqual({
          _id: payload._id,
          _creationTime: payload._creationTime,
          codecVersion: 1,
          json: h.recordJSON,
          owner: { kind: "operation", operationId: row._id },
        });
        expect(trace[0].reply).toEqual({
          status: "created",
          operationId: row._id,
        });
      } else {
        expect({
          operations: after.operations.length,
          attempts: after.attempts.length,
          events: after.events.length,
          payloads: after.payloads.length,
        }).toEqual({ operations: 1, attempts: 1, events: 0, payloads: 1 });
        const attempt = after.attempts[0];
        expect(after.operations).toEqual([
          {
            ...operation,
            revision: 1,
            state: "RESERVED",
            activeAttemptId: attempt._id,
          },
        ]);
        expect(after.payloads).toEqual(before.payloads);
        expect(after.events).toEqual(before.events);
        expect(attempt).toEqual({
          _id: attempt._id,
          _creationTime: attempt._creationTime,
          operationId: operation._id,
          payloadId: operation.payloadId,
          recordVersion: 2,
          stage: "attach",
          authorizationScope: h.record.authorization.scope,
          authorizationId: h.record.authorization.id,
          authorizationRevision: h.record.authorization.revision,
          logicalOperationId: h.record.logicalOperationId,
          requestBinding: h.record.requestBinding,
          key: h.request.key,
          apiVersion: h.request.apiVersion,
          accountJSON: canonical(h.record.account),
          timingPolicyJSON: canonical(h.record.timingPolicy),
          firstDispatchedAt: h.request.firstDispatchedAt,
          ordinal: 1,
          preparedRevision: 0,
          committedRevision: 1,
          lastSequence: 0,
        });
        const { _id, _creationTime, lastSequence, ...fields } = attempt;
        void _creationTime;
        void lastSequence;
        expect(trace[0].reply).toEqual({
          disposition: "acquired",
          previousRevision: 0,
          committedRevision: 1,
          reservation: { ...fields, attemptId: _id, recordJSON: h.recordJSON },
        });
      }
      for (const rows of Object.values(after))
        for (const row of rows) {
          expect(Number.isFinite(row._creationTime)).toBe(true);
          expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
        }
      expect(getConvexSize(after)).toBeLessThanOrEqual(VALUE_LIMIT);
      expect(canonical(h.record)).toBe(h.recordJSON);
    } catch (error) {
      targetFailed = true;
      throw error;
    } finally {
      try {
        const after = await physical();
        console.info(
          "JOURNAL_ACTION_MECHANICAL_SETTLEMENT",
          JSON.stringify({
            phase: scenario.phase,
            parent: scenario.parent,
            childFulfillments: trace.length,
            physicalEqual: JSON.stringify(after) === JSON.stringify(stable),
            counts: {
              operations: after.operations.length,
              attempts: after.attempts.length,
              events: after.events.length,
              payloads: after.payloads.length,
            },
            fetchCalls: h.fetchCalls(),
          }),
        );
        expect(after).toEqual(stable);
        expect(h.fetchCalls()).toBe(0);
      } catch (inspectionError) {
        if (!targetFailed) throw inspectionError;
        console.info("JOURNAL_ACTION_MECHANICAL_INSPECTION_FAILED");
      }
    }
  },
);

type GeneratedLoad = FunctionReturnType<
  typeof generatedComponents.betterStripe.renewalOperations.queries.loadAuthorizedOperation
>;
const adapterRead = makeFunctionReference<
  "action",
  { operationId: string },
  { direct: GeneratedLoad; adapter: GeneratedLoad }
>("adapterHost:readExisting");

it("ADAPTER01 loads the actual existing operation through the private Action adapter", async () => {
  const h = await codecFixture();
  const progress = { entries: 0, directLoads: 0, captures: 0, adapterCalls: 0 };
  const inspection = {
    physical: componentQuery({
      args: {},
      handler: async (ctx): Promise<Physical> => ({
        operations: await ctx.db.query("renewalOperations").take(3),
        attempts: await ctx.db.query("renewalOperationAttempts").take(3),
        events: await ctx.db.query("renewalOperationEvents").take(4),
        payloads: await ctx.db.query("renewalOperationPayloads").take(6),
      }),
    }),
  };
  const host = {
    readExisting: actionGeneric({
      args: { operationId: v.string() },
      handler: async (ctx, args) => {
        progress.entries++;
        expect(await ctx.meta.getFunctionMetadata()).toEqual({
          name: "adapterHost:readExisting",
          componentPath: "",
          type: "action",
          visibility: "public",
        });
        const direct = await ctx.runQuery(
          generatedComponents.betterStripe.renewalOperations.queries
            .loadAuthorizedOperation,
          args,
        );
        expect(direct).toEqual({
          recordVersion: 2,
          operationId: args.operationId,
          recordJSON: h.recordJSON,
          revision: 0,
          activeAttempt: null,
          initialBasis: null,
        });
        expect(getConvexSize(direct)).toBeLessThanOrEqual(VALUE_LIMIT);
        progress.directLoads++;
        // Actual read-only component query, not a caller-provided physical DTO.
        expect(
          await ctx.runQuery(
            nested.betterStripe.adapterInspection.physical,
            {},
          ),
        ).toEqual(before);
        const journal = await createActionOperationJournal(
          ctx,
          generatedComponents.betterStripe,
          args.operationId,
        );
        progress.captures++;
        const adapter = await journal.loadAuthorizedOperation();
        progress.adapterCalls++;
        return { direct, adapter };
      },
    }),
  };
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./adapterHost.ts": async () => host,
  });
  expect(
    Object.prototype.hasOwnProperty.call(
      modules,
      "./component/adapterInspection.ts",
    ),
  ).toBe(false);
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/adapterInspection.ts": async () => inspection,
  });
  const physical = async (): Promise<Physical> =>
    t.query(nested.betterStripe.adapterInspection.physical, {});
  expect(await physical()).toEqual({
    operations: [],
    attempts: [],
    events: [],
    payloads: [],
  });
  const createArgs = {
    authorizationScope: h.record.authorization.scope,
    logicalOperationId: h.record.logicalOperationId,
    authorizationRevision: h.record.authorization.revision,
    recordJSON: h.recordJSON,
  };
  expect(getConvexSize(createArgs)).toBeLessThanOrEqual(VALUE_LIMIT);
  const created = await t.mutation(
    generatedComponents.betterStripe.renewalOperations.mutations
      .createAuthorizedOperation,
    createArgs,
  );
  if (created.status !== "created")
    throw Error("ADAPTER_CREATE_PREREQUISITE_STOP");
  const before = await physical();
  expect({
    operations: before.operations.length,
    attempts: before.attempts.length,
    events: before.events.length,
    payloads: before.payloads.length,
  }).toEqual({ operations: 1, attempts: 0, events: 0, payloads: 1 });
  const operation = before.operations[0];
  const payload = before.payloads[0];
  expect(operation).toMatchObject({
    _id: created.operationId,
    recordVersion: 2,
    payloadId: payload._id,
    revision: 0,
    state: "PREPARED",
  });
  expect(payload).toMatchObject({
    codecVersion: 1,
    json: h.recordJSON,
    owner: { kind: "operation", operationId: created.operationId },
  });
  for (const rows of Object.values(before))
    for (const row of rows)
      expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
  const args = { operationId: created.operationId };
  expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
  let targetFailed = false;
  try {
    const result = await t.action(adapterRead, args);
    expect(progress).toEqual({
      entries: 1,
      directLoads: 1,
      captures: 1,
      adapterCalls: 1,
    });
    expect(result.direct).toEqual({
      recordVersion: 2,
      ...args,
      recordJSON: h.recordJSON,
      revision: 0,
      activeAttempt: null,
      initialBasis: null,
    });
    expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
    // Intended adapter-specific null-vs-complete-operation RED, after all prerequisites.
    expect(result.adapter).toEqual(result.direct);
  } catch (error) {
    targetFailed = true;
    throw error;
  } finally {
    try {
      expect(await physical()).toEqual(before);
      expect(h.fetchCalls()).toBe(0);
      console.info(
        "ADAPTER01_SETTLEMENT",
        JSON.stringify({
          ...progress,
          physicalEqual: true,
          fetchCalls: h.fetchCalls(),
        }),
      );
    } catch (inspectionError) {
      if (!targetFailed) throw inspectionError;
      console.info("ADAPTER01_INSPECTION_FAILED");
    }
  }
});
