import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import {
  anyApi,
  componentsGeneric,
  createFunctionHandle,
  defineSchema,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { v } from "convex/values";
import { modules, schema } from "../../test.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
const nested = componentsGeneric();
const scope = {
  accountId: "acct_a",
  scopeKey: "seller",
  currency: "usd",
  groupKey: "journal",
};
const host = {
  provider: internalActionGeneric({
    args: {
      ...Object.fromEntries(Object.keys(scope).map((k) => [k, v.string()])),
      operationId: v.string(),
      version: v.number(),
      providerApiVersion: v.string(),
      definitionVersion: v.number(),
      phase: v.string(),
    },
    returns: v.any(),
    handler: async () => {
      throw new Error("sk_test_PRIVATE accidental provider body");
    },
  }),
  start: internalMutationGeneric({
    args: {},
    returns: v.any(),
    handler: async (ctx) =>
      ctx.runMutation(nested.betterStripe.recoveryWorkflow.mutations.start, {
        ...scope,
        requestKey: "journal",
        provider: await createFunctionHandle(anyApi.host.provider),
        providerApiVersion: "2026-09-30.endive",
        definitionVersion: 1,
        releaseUncollectible: false,
        maxAttempts: 3,
        retryDelayMs: 1,
      }),
  }),
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("journals only a closed sanitized outcome from a throwing host action", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/api.ts": async () => ({}),
    "./host.ts": async () => host,
  });
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/fixture.ts": async () => ({
      history: internalQueryGeneric({
        args: {},
        returns: v.any(),
        handler: async (ctx) => {
          const op = (await ctx.db
            .query("recoveryWorkflowOperations")
            .first())!;
          return executionWorkflow.listSteps(ctx, op.workflowId, {
            paginationOpts: { cursor: null, numItems: 100 },
          });
        },
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  await t.run((ctx) =>
    ctx.runMutation(nested.betterStripe.costRecovery.preparation.prepare, {
      ...scope,
      sourceKind: "invoice",
      sourceId: "in_a",
      maxDebit: 100,
      maxCredit: 0,
    }),
  );
  await t.mutation(anyApi.host.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const history = await t.query(nested.betterStripe.fixture.history, {});
  const text = JSON.stringify(history);
  expect(text).not.toContain("sk_test_PRIVATE");
  expect(text).not.toContain("accidental provider body");
  expect(
    history.page.find((step: { name: string }) =>
      step.name.startsWith("provider-"),
    ),
  ).toMatchObject({
    runResult: {
      kind: "success",
      returnValue: { status: "unknown", reason: "provider_outcome_unknown" },
    },
  });
});
