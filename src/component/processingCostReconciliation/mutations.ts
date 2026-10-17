import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import { anyApi, type FunctionReference } from "convex/server";
import { mutation } from "../_generated/server.js";
import { startFields, safeStatus, failure, refFields } from "./schema.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { calculateProcessingCostDeficit } from "../../client/processingCostDeficit/index.js";
import { validateScope } from "../costRecovery/helpers.js";
import { same } from "../recoveryWorkflow/helpers.js";
import { conflict, reference, status, read } from "./helpers.js";
const workflow = anyApi.processingCostReconciliation.workflow
  .run as FunctionReference<"mutation", "internal">;
export const start = mutation({
  args: startFields,
  returns: v.union(safeStatus, failure),
  handler: async (ctx, args) => {
    validateScope(args);
    if (
      !args.requestKey ||
      !args.claimKey ||
      args.claimKey.startsWith("rollback:") ||
      !args.source.paymentIntentId ||
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < -1 ||
      (args.rollback !== undefined &&
        (!args.rollback.groupKey ||
          !Number.isSafeInteger(args.rollback.expectedRevision) ||
          args.rollback.expectedRevision < -1)) ||
      (args.source.kind === "invoice_recovery" &&
        (!args.rollback || args.rollback.groupKey !== args.source.groupKey)) ||
      args.definitionVersion !== 1 ||
      !/^\d{4}-\d{2}-\d{2}\.[a-z][a-z0-9_.-]*$/.test(args.providerApiVersion) ||
      !Number.isSafeInteger(args.maxAttempts) ||
      args.maxAttempts < 1 ||
      args.maxAttempts > 20 ||
      !Number.isSafeInteger(args.retryDelayMs) ||
      args.retryDelayMs < 1 ||
      args.retryDelayMs > 86400000
    )
      throw new Error("Invalid processing-cost reconciliation policy.");
    calculateProcessingCostDeficit({
      currency: args.currency,
      gross: args.source.gross,
      ...args.policy,
      processingFee: 0,
      principalReturned: 0,
      disputeFees: 0,
    });
    const prior = await ctx.db
      .query("processingCostReconciliationOperations")
      .withIndex("by_request", (q) => q.eq("requestKey", args.requestKey))
      .unique();
    if (prior) {
      const binding = Object.fromEntries(
        Object.keys(startFields).map((k) => [
          k,
          prior[k as keyof typeof prior],
        ]),
      );
      if (!same(binding, args)) return conflict("identity_changed");
      return status(prior);
    }
    const id = await ctx.db.insert("processingCostReconciliationOperations", {
      ...args,
      version: 1,
      status: "queued",
    });
    const op = (await ctx.db.get(
      "processingCostReconciliationOperations",
      id,
    ))!;
    const canonical = await ctx.db
      .query("processingCostReconciliationOperations")
      .withIndex("by_payment_scope", (q) =>
        q
          .eq("accountId", args.accountId)
          .eq("scopeKey", args.scopeKey)
          .eq("currency", args.currency)
          .eq("source.paymentIntentId", args.source.paymentIntentId),
      )
      .first();
    if (canonical && canonical.claimKey !== args.claimKey) {
      const failure = conflict("identity_changed");
      await ctx.db.patch("processingCostReconciliationOperations", id, {
        status: "conflict",
        failure,
      });
      return { ...reference(op), ...failure };
    }
    const workflowId = await executionWorkflow.start(
      ctx,
      workflow,
      reference(op),
      { startAsync: true },
    );
    await ctx.db.patch("processingCostReconciliationOperations", id, {
      workflowId,
    });
    return status(op);
  },
});

export const resume = mutation({
  args: refFields,
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (
      op.result ||
      (op.failure && ["conflict", "rejected"].includes(op.failure.status))
    )
      return status(op);
    const state = await executionWorkflow.status(
      ctx,
      op.workflowId as WorkflowId,
    );
    if (state.type === "inProgress") return status(op);
    if (state.type === "failed") {
      const last = (
        await executionWorkflow.listSteps(ctx, op.workflowId as WorkflowId, {
          order: "desc",
          paginationOpts: { cursor: null, numItems: 1 },
        })
      ).page[0];
      if (last?.name === "apply" && last.runResult?.kind === "failed") {
        await executionWorkflow.restart(ctx, op.workflowId as WorkflowId, {
          from: last.stepNumber,
          startAsync: true,
        });
        return status(op);
      }
    }
    const workflowId = await executionWorkflow.start(
      ctx,
      workflow,
      reference(op),
      { startAsync: true },
    );
    await ctx.db.patch("processingCostReconciliationOperations", op._id, {
      workflowId,
      status: "queued",
      failure: undefined,
    });
    return status(
      (await ctx.db.get("processingCostReconciliationOperations", op._id))!,
    );
  },
});
