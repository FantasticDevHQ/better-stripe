// One real BetterStripe component and its nested runtime; only provider HTTP responses are synthetic.
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { afterEach, beforeEach, vi } from "vitest";
import { schema, modules } from "../../test.js";
import { getStripeClient } from "../../client/helpers.js";
import { executionWorkflow } from "../../component/durableExecution/runtime.js";
import { host } from "./host.js";
import { reset, httpClient, secret, preview } from "./transport.js";
export { scope, fundingScope } from "./host.js";
export { wire } from "./transport.js";
beforeEach(() => {
  vi.useFakeTimers();
  reset();
  // Funding has no transport option; configure only the test-key SDK cache entry.
  const stripe = getStripeClient(secret, preview);
  const set = stripe as unknown as {
    _setApiField: (key: string, value: unknown) => void;
  };
  set._setApiField("httpClient", httpClient);
  set._setApiField("maxNetworkRetries", 0);
});
afterEach(() => vi.useRealTimers());
export function fixture() {
  const t = convexTest(
    defineSchema({
      reports: defineTable({
        domain: v.string(),
        operationId: v.string(),
        version: v.number(),
        amount: v.number(),
      }).index("by_operation", ["operationId"]),
    }),
    {
      "./_generated/api.ts": async () => ({}),
      "./host.ts": async () => host,
    },
  );
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/crossDomainFixture.ts": async () => ({
      cleanFundingHistory: internalMutationGeneric({
        args: { operationId: v.id("balanceFundingOperations") },
        returns: v.any(),
        handler: async (ctx, args) => {
          const op = await ctx.db.get(
            "balanceFundingOperations",
            args.operationId,
          );
          if (!op?.execution?.workflowId)
            throw new Error("Missing test workflow");
          return executionWorkflow.cleanup(
            ctx,
            op.execution.workflowId as WorkflowId,
          );
        },
      }),
      journals: internalQueryGeneric({
        args: {},
        returns: v.any(),
        handler: async (ctx) => {
          const ids: string[] = [];
          for (const op of await ctx.db
            .query("balanceFundingOperations")
            .take(20))
            if (op.execution?.workflowId) ids.push(op.execution.workflowId);
          for (const op of await ctx.db
            .query("recoveryWorkflowOperations")
            .take(20))
            if (op.workflowId) ids.push(op.workflowId);
          for (const op of await ctx.db
            .query("processingCostReconciliationOperations")
            .take(20))
            if (op.workflowId) ids.push(op.workflowId);
          return Promise.all(
            ids.map((id) =>
              executionWorkflow.listSteps(ctx, id as WorkflowId, {
                paginationOpts: { cursor: null, numItems: 100 },
              }),
            ),
          );
        },
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  return t;
}
