import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import {
  anyApi,
  componentsGeneric,
  defineSchema,
  defineTable,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CostRecoveryClient } from "../../client/costRecovery.js";
import type { Component } from "../../client/helpers.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { schema, modules } from "../../test.js";
const nested = componentsGeneric();
const scope = { accountId: "acct_seller", scopeKey: "store", currency: "usd" };
const observation = {
  paymentIntentId: "pi_a",
  sourceChargeId: "ch_a",
  currency: "usd",
  gross: 1000,
  originalProcessingFee: 30,
  processingFee: 30,
  disputeFees: 0,
  principalReturned: 1000,
  provenance: {
    invoiceId: "in_a",
    invoicePaymentId: "inpay_a",
    customerAccountId: "acct_buyer",
    stripePriceId: "price_original",
    stripeProductId: "prod_original",
  },
};
const client = () =>
  new CostRecoveryClient(nested.betterStripe as unknown as Component);
let calls = 0,
  projectionFailures = 0;
let outcome: unknown;
let providerGate: Promise<void> | null;
const host = {
  start: internalMutationGeneric({
    args: {},
    returns: v.any(),
    handler: (ctx) =>
      client().startProcessingCostReconciliation(ctx, {
        ...scope,
        claimKey: "cost:pi_a",
        requestKey: "workflow-refund",
        expectedRevision: -1,
        source: {
          kind: "sale",
          paymentIntentId: "pi_a",
          gross: 1000,
          customerAccountId: "acct_buyer",
          invoiceId: "in_a",
        },
        policy: {
          sellingFee: 100,
          liability: { processingCosts: "uncovered", disputeCosts: "all" },
          rounding: "nearest",
        },
        provider: anyApi.host.provider as FunctionReference<
          "action",
          "internal"
        >,
        projection: anyApi.host.project as FunctionReference<
          "mutation",
          "internal"
        >,
        providerApiVersion: "2026-09-30.endive",
        definitionVersion: 1,
        maxAttempts: 2,
        retryDelayMs: 1,
      }),
  }),
  provider: internalActionGeneric({
    args: {
      ...Object.fromEntries(Object.keys(scope).map((k) => [k, v.string()])),
      operationId: v.string(),
      version: v.number(),
      providerApiVersion: v.string(),
      definitionVersion: v.number(),
    },
    returns: v.any(),
    handler: async (_ctx, args) => {
      calls++;
      if (providerGate) await providerGate;
      if (outcome instanceof Error) throw outcome;
      return { ...args, outcome };
    },
  }),
  project: internalMutationGeneric({
    args: {
      ...Object.fromEntries(Object.keys(scope).map((k) => [k, v.string()])),
      operationId: v.string(),
      version: v.number(),
      status: v.literal("completed"),
      result: v.any(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      if (projectionFailures-- > 0) throw new Error("private database detail");
      await ctx.db.insert("reports", {
        operationId: args.operationId,
        revision: args.result.claim.revision,
      });
      return null;
    },
  }),
  resume: internalMutationGeneric({
    args: { operationId: v.string(), version: v.number() },
    returns: v.any(),
    handler: (ctx, args) =>
      client().resumeProcessingCostReconciliation(ctx, { ...scope, ...args }),
  }),
  freshClaim: internalMutationGeneric({
    args: {},
    returns: v.any(),
    handler: (ctx) =>
      client().recordClaim(ctx, {
        ...scope,
        claimKey: "cost:pi_a",
        sourceChargeId: "ch_a",
        sourceGross: 1000,
        sourceProcessingFee: 30,
        amountDue: 15,
        revision: 0,
      }),
  }),
};
async function fixture() {
  const t = convexTest(
    defineSchema({
      reports: defineTable({ operationId: v.string(), revision: v.number() }),
    }),
    { "./_generated/api.ts": async () => ({}), "./host.ts": async () => host },
  );
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/fixture.ts": async () => ({
      history: internalQueryGeneric({
        args: {},
        returns: v.any(),
        handler: async (ctx) => {
          const op = (await ctx.db
            .query("processingCostReconciliationOperations")
            .first())!;
          return executionWorkflow.listSteps(ctx, op.workflowId!, {
            paginationOpts: { cursor: null, numItems: 100 },
          });
        },
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  return t;
}
const ref = (op: { operationId: string; version: number }) => ({
  ...scope,
  operationId: op.operationId,
  version: op.version,
});
beforeEach(() => {
  vi.useFakeTimers();
  calls = 0;
  projectionFailures = 0;
  providerGate = null;
  outcome = { status: "ready", value: observation };
});
afterEach(() => vi.useRealTimers());
it("runs through the public SDK and real nested Workflow once", async () => {
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  expect((await t.mutation(anyApi.host.start, {})).operationId).toBe(
    op.operationId,
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(
      nested.betterStripe.processingCostReconciliation.queries.get,
      ref(op),
    ),
  ).toMatchObject({
    status: "completed",
    result: { claim: { revision: 0, amountDue: 30 } },
  });
  expect(calls).toBe(1);
  expect(await t.run((ctx) => ctx.db.query("reports").collect())).toHaveLength(
    1,
  );
});
it("restarts failed database projection using the saved provider observation", async () => {
  const t = await fixture();
  projectionFailures = 1;
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(nested.betterStripe.costRecovery.queries.claim, {
      claimKey: "cost:pi_a",
    }),
  ).toBeNull();
  expect(calls).toBe(1);
  await t.mutation(anyApi.host.resume, {
    operationId: op.operationId,
    version: op.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(1);
  expect(
    await t.query(
      nested.betterStripe.processingCostReconciliation.queries.get,
      ref(op),
    ),
  ).toMatchObject({ status: "completed" });
});
it("a racing authoritative claim revision wins before a stale provider observation commits", async () => {
  let release!: () => void;
  providerGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const t = await fixture();
  const op = await t.mutation(anyApi.host.start, {});
  const drain = t.finishAllScheduledFunctions(vi.runAllTimers);
  await vi.waitFor(() => expect(calls).toBe(1));
  await t.mutation(anyApi.host.freshClaim, {});
  release();
  await drain;
  expect(
    await t.query(
      nested.betterStripe.processingCostReconciliation.queries.get,
      ref(op),
    ),
  ).toMatchObject({ status: "conflict", reason: "revision_changed" });
  expect(
    await t.query(nested.betterStripe.costRecovery.queries.claim, {
      claimKey: "cost:pi_a",
    }),
  ).toMatchObject({ revision: 0, amountDue: 15 });
  expect(await t.run((ctx) => ctx.db.query("reports").collect())).toEqual([]);
});

it.each([
  new Error("sk_test_PRIVATE accidental provider body"),
  {
    status: "ready",
    value: { ...observation, privateMetadata: "sk_test_PRIVATE" },
  },
])(
  "holds unknown observations without journaling provider details and explicitly resumes",
  async (unsafe) => {
    const t = await fixture();
    outcome = unsafe;
    const op = await t.mutation(anyApi.host.start, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toBe(1);
    expect(
      await t.query(
        nested.betterStripe.processingCostReconciliation.queries.get,
        ref(op),
      ),
    ).toMatchObject({
      status: "unknown",
      reason: "provider_outcome_unknown",
      retryable: false,
    });
    expect(
      await t.query(nested.betterStripe.costRecovery.queries.claim, {
        claimKey: "cost:pi_a",
      }),
    ).toBeNull();
    const journal = JSON.stringify(
      await t.query(nested.betterStripe.fixture.history, {}),
    );
    expect(journal).not.toContain("sk_test_PRIVATE");
    expect(journal).not.toContain("accidental provider body");
    expect(journal).not.toContain("privateMetadata");
    outcome = { status: "ready", value: observation };
    await t.mutation(anyApi.host.resume, {
      operationId: op.operationId,
      version: op.version,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toBe(2);
    expect(
      await t.query(
        nested.betterStripe.processingCostReconciliation.queries.get,
        ref(op),
      ),
    ).toMatchObject({
      status: "completed",
      result: { claim: { revision: 0, amountDue: 30 } },
    });
  },
);
it("bounds known pending retries without creating a zero-cost claim", async () => {
  const t = await fixture();
  outcome = { status: "not_ready", reason: "fee_pending", retryable: true };
  const op = await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(2);
  expect(
    await t.query(
      nested.betterStripe.processingCostReconciliation.queries.get,
      ref(op),
    ),
  ).toMatchObject({ status: "not_ready", reason: "fee_pending" });
  expect(
    await t.query(nested.betterStripe.costRecovery.queries.claim, {
      claimKey: "cost:pi_a",
    }),
  ).toBeNull();
  outcome = { status: "ready", value: observation };
  await t.mutation(anyApi.host.resume, {
    operationId: op.operationId,
    version: op.version,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toBe(3);
  expect(
    await t.query(
      nested.betterStripe.processingCostReconciliation.queries.get,
      ref(op),
    ),
  ).toMatchObject({ status: "completed", result: { claim: { revision: 0 } } });
});
