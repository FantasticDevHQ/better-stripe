import assert from "node:assert/strict";
import { BetterStripe } from "../../../../index.js";
import { components } from "../../../../../../example/convex/_generated/api.js";
import { captureMaintainedActionSelection } from "./classOwnedActionRoot.js";
import { createClassActionOperationJournal } from "../operationJournal.js";
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
type Loaded = FunctionReturnType<typeof refs.queries.loadAuthorizedOperation>;
const call = makeFunctionReference<
  "action",
  { operationId: string },
  { direct: Loaded; actual: Loaded }
>("classJournal:initial");
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

it("CLASS-JOURNAL01 binds the actual SDK and registered Action before journal DATA load", async () => {
  // Complete source/policy/unknown fields are declared by maintained offline codecFixture.
  // Probe is a separate logical operation; target remains PREPARED throughout.
  const h = await codecFixture();
  const probeLogicalId = h.record.logicalOperationId + "-class-journal-probe";
  const probeJSON = canonical({
    ...h.record,
    logicalOperationId: probeLogicalId,
  });
  const sdk = new BetterStripe(components.betterStripe, {
    STRIPE_SECRET_KEY: "sk_test_invalid_class_journal_fixture",
  });
  expect(sdk).toBeInstanceOf(BetterStripe);
  expect(Object.getPrototypeOf(sdk)).toBe(BetterStripe.prototype);
  expect(Object.getOwnPropertySymbols(sdk)).toEqual([]);
  const keyDescriptor = Object.getOwnPropertyDescriptor(sdk, "_apiKey");
  assert(
    keyDescriptor && "value" in keyDescriptor && keyDescriptor.configurable,
  );
  let selectorReads = 0;
  Object.defineProperty(sdk, "_apiKey", {
    configurable: true,
    enumerable: keyDescriptor.enumerable,
    get() {
      selectorReads++;
      throw Error("CLASS_JOURNAL_SELECTOR_TOUCHED");
    },
  });
  try {
    const progress = { action: 0, operationalRefused: 0, direct: 0, target: 0 };
    const host = {
      initial: actionGeneric({
        args: { operationId: v.string() },
        handler: async (
          ctx,
          args,
        ): Promise<FunctionReturnType<typeof call>> => {
          progress.action++;
          const metadata = {
            name: "classJournal:initial",
            componentPath: "",
            type: "action",
            visibility: "public",
          };
          expect(await ctx.meta.getFunctionMetadata()).toEqual(metadata);
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
          expect(getConvexSize(direct)).toBeLessThanOrEqual(VALUE_LIMIT);
          progress.direct++;
          // Existing operational bridge remains genuinely EMPTY; no qualifier flag.
          await expect(
            captureMaintainedActionSelection(sdk, {
              actualActionCtx: ctx,
              operationId: args.operationId,
            }),
          ).rejects.toThrow(/^CLASS_ACTION_PROFILE_UNBOUND$/);
          progress.operationalRefused++;
          const clone = Object.create(Object.getPrototypeOf(sdk));
          await expect(
            captureMaintainedActionSelection(clone, {
              actualActionCtx: ctx,
              operationId: args.operationId,
            }),
          ).rejects.toThrow(/^CLASS_ACTION_ROOT_UNBOUND$/);
          expect(
            await ctx.runQuery(
              nested.betterStripe.classJournalInspection.physical,
              {},
            ),
          ).toEqual(before);
          expect(await ctx.meta.getFunctionMetadata()).toEqual(metadata);
          const journal = await createClassActionOperationJournal(sdk, {
            actualActionCtx: ctx,
            operationId: args.operationId,
          });
          progress.target++;
          // First narrow missing class-journal factory NULL seam; not a missing import/ref.
          expect(journal).not.toBeNull();
          assert(journal !== null);
          expect(Object.isFrozen(journal)).toBe(true);
          const actual = await journal.loadAuthorizedOperation();
          expect(actual).toEqual(direct);
          // A working journal binding still cannot unlock operational selection.
          await expect(
            captureMaintainedActionSelection(sdk, {
              actualActionCtx: ctx,
              operationId: args.operationId,
            }),
          ).rejects.toThrow(/^CLASS_ACTION_PROFILE_UNBOUND$/);
          return { direct, actual };
        },
      }),
    };
    const t = convexTest(defineSchema({}), {
      "./_generated/api.ts": async () => ({}),
      "./classJournal.ts": async () => host,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        modules,
        "./component/classJournalInspection.ts",
      ),
    ).toBe(false);
    t.registerComponent("betterStripe", schema, {
      ...modules,
      "./component/classJournalInspection.ts": async () => inspection,
    });
    const physical = async (): Promise<Physical> =>
      t.query(nested.betterStripe.classJournalInspection.physical, {});
    expect(await physical()).toEqual({
      operations: [],
      attempts: [],
      events: [],
      payloads: [],
    });
    const createInput = {
      authorizationScope: h.record.authorization.scope,
      authorizationRevision: h.record.authorization.revision,
      logicalOperationId: h.record.logicalOperationId,
      recordJSON: h.recordJSON,
    };
    const probe = await t.mutation(refs.mutations.createAuthorizedOperation, {
      ...createInput,
      logicalOperationId: probeLogicalId,
      recordJSON: probeJSON,
    });
    assert(probe.status === "created");
    const probeArgs = { operationId: probe.operationId };
    const acquired = await t.mutation(refs.mutations.reserveAttempt, {
      ...probeArgs,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: h.record.requestBinding,
      recordJSON: probeJSON,
    });
    assert(acquired.disposition === "acquired");
    expect(acquired.reservation.recordJSON).toBe(probeJSON);
    const existing = await t.mutation(refs.mutations.reserveAttempt, {
      ...probeArgs,
      expectedRevision: 0,
      stage: "attach",
      expectedRequestBinding: h.record.requestBinding,
      recordJSON: probeJSON,
    });
    expect(existing).toEqual({
      disposition: "existing",
      committedRevision: 1,
      reservation: acquired.reservation,
    });
    const created = await t.mutation(
      refs.mutations.createAuthorizedOperation,
      createInput,
    );
    assert(created.status === "created");
    const args = { operationId: created.operationId };
    const expected = {
      recordVersion: 2,
      ...args,
      recordJSON: h.recordJSON,
      revision: 0,
      activeAttempt: null,
      initialBasis: null,
    };
    expect(await t.query(refs.queries.loadAuthorizedOperation, args)).toEqual(
      expected,
    );
    const before = await physical();
    expect({
      operations: before.operations.length,
      attempts: before.attempts.length,
      events: before.events.length,
      payloads: before.payloads.length,
    }).toEqual({ operations: 2, attempts: 1, events: 0, payloads: 2 });
    const target = before.operations.find(
      (row) => row._id === created.operationId,
    );
    assert(target);
    expect(target).toMatchObject({
      recordVersion: 2,
      state: "PREPARED",
      revision: 0,
    });
    expect(target.activeAttemptId).toBeUndefined();
    expect(target.knownAcknowledgement).toBeUndefined();
    const source = before.payloads.find((row) => row._id === target.payloadId);
    assert(source);
    expect(source.json).toBe(h.recordJSON);
    expect(source.owner).toEqual({ kind: "operation", ...args });
    const probeSource = before.payloads.find(
      (row) => row._id === acquired.reservation.payloadId,
    );
    assert(probeSource);
    expect(probeSource.json).toBe(probeJSON);
    expect(probeSource.owner).toEqual({ kind: "operation", ...probeArgs });
    for (const rows of Object.values(before))
      for (const row of rows)
        expect(getDocumentSize(row)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(getConvexSize(args)).toBeLessThanOrEqual(VALUE_LIMIT);
    let failed = false;
    try {
      const result = await t.action(call, args);
      expect(progress).toEqual({
        action: 1,
        operationalRefused: 1,
        direct: 1,
        target: 1,
      });
      expect(result).toEqual({ direct: expected, actual: expected });
      expect(getConvexSize(result)).toBeLessThanOrEqual(VALUE_LIMIT);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        expect(await physical()).toEqual(before);
        expect(
          await t.query(refs.queries.loadAuthorizedOperation, args),
        ).toEqual(expected);
        expect(h.fetchCalls()).toBe(0);
        expect(selectorReads).toBe(0);
        expect(Object.getOwnPropertySymbols(sdk)).toEqual([]);
        console.info(
          "CLASS_JOURNAL01_SETTLEMENT",
          JSON.stringify({
            ...progress,
            physicalEqual: true,
            targetPrepared: true,
            selectorReads,
            fetchCalls: 0,
          }),
        );
      } catch (error) {
        if (!failed) throw error;
        console.info("CLASS_JOURNAL01_INSPECTION_FAILED");
      }
    }
  } finally {
    Object.defineProperty(sdk, "_apiKey", keyDescriptor);
  }
});
