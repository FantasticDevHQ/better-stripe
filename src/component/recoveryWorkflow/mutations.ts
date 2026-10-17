import { allocationFields } from "../settlement/schema.js";
import { anyApi, type FunctionReference } from "convex/server";
import type { WorkflowId } from "@convex-dev/workflow";
import { mutation } from "../_generated/server.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { validateScope } from "../costRecovery/helpers.js";
import {
  bindingFields,
  startFields,
  startResult,
  refFields,
  safeStatus,
} from "./schema.js";
import { identityConflict, read, reference, same, status } from "./helpers.js";
const workflow = anyApi.recoveryWorkflow.workflow.run as FunctionReference<
  "mutation",
  "internal"
>;
export const start = mutation({
  args: startFields,
  returns: startResult,
  handler: async (ctx, args) => {
    validateScope(args);
    if (
      !args.requestKey ||
      !args.provider ||
      !/^\d{4}-\d{2}-\d{2}\.[a-z][a-z0-9_.-]*$/.test(args.providerApiVersion) ||
      args.definitionVersion !== 1 ||
      !Number.isSafeInteger(args.maxAttempts) ||
      args.maxAttempts < 1 ||
      args.maxAttempts > 20 ||
      !Number.isSafeInteger(args.retryDelayMs) ||
      args.retryDelayMs < 1 ||
      args.retryDelayMs > 86400000
    )
      throw new Error("Invalid recovery workflow policy.");
    const { requestKey, ...binding } = args;
    const request = await ctx.db
      .query("recoveryWorkflowRequests")
      .withIndex("by_key", (q) => q.eq("requestKey", requestKey))
      .unique();
    if (request) {
      if (!same(request.binding, binding)) return identityConflict;
      return status(
        (await ctx.db.get("recoveryWorkflowOperations", request.operationId))!,
      );
    }
    const group = await ctx.db
      .query("recoveryGroups")
      .withIndex("by_key", (q) => q.eq("groupKey", args.groupKey))
      .unique();
    if (
      !group ||
      group.accountId !== args.accountId ||
      group.scopeKey !== args.scopeKey ||
      group.currency !== args.currency
    )
      return identityConflict;
    const existing = await ctx.db
      .query("recoveryWorkflowOperations")
      .withIndex("by_group", (q) => q.eq("groupKey", args.groupKey))
      .unique();
    if (existing) {
      const saved = Object.fromEntries(
        Object.keys(bindingFields).map((k) => [
          k,
          existing[k as keyof typeof existing],
        ]),
      );
      if (!same(saved, binding)) return identityConflict;
      await ctx.db.insert("recoveryWorkflowRequests", {
        requestKey,
        binding,
        operationId: existing._id,
      });
      return status(existing);
    }
    if (group.status !== "sealed")
      return {
        status: "not_ready",
        reason: "history_incomplete",
        retryable: true,
      } as const;
    if (group.sourceKind === "settlement") {
      const a = args.allocation;
      if (
        !a ||
        a.sourceChargeId !== group.sourceId ||
        a.currency !== group.currency ||
        a.gross !== group.sourceGross ||
        a.processingFee !== group.sourceProcessingFee ||
        (a.adjustmentAmount ?? 0) !== group.amount
      )
        return identityConflict;
      const priorOperation = await ctx.db
        .query("recoveryWorkflowOperations")
        .withIndex("by_source", (q) =>
          q.eq("sourceKind", "settlement").eq("sourceId", group.sourceId),
        )
        .first();
      if (priorOperation) return identityConflict;
      const prior = await ctx.db
        .query("settlementAllocations")
        .withIndex("by_source_charge", (q) =>
          q.eq("sourceChargeId", a.sourceChargeId),
        )
        .first();
      if (
        prior &&
        !same(
          Object.fromEntries(
            Object.keys(allocationFields).map((k) => [
              k,
              prior[k as keyof typeof prior],
            ]),
          ),
          a,
        )
      )
        return identityConflict;
      await ctx.runMutation(
        anyApi.settlement.mutations.reserveSettlementAllocation,
        a,
      );
    } else if (args.allocation) return identityConflict;
    const operationId = await ctx.db.insert("recoveryWorkflowOperations", {
      ...binding,
      sourceKind: group.sourceKind,
      sourceId: group.sourceId,
      version: 1,
      status: "queued",
      cancelRequested: false,
      providerStarted: false,
      resumeQueued: false,
    });
    const op = (await ctx.db.get("recoveryWorkflowOperations", operationId))!;
    await ctx.db.insert("recoveryWorkflowRequests", {
      requestKey,
      binding,
      operationId,
    });
    const workflowId = await executionWorkflow.start(
      ctx,
      workflow,
      { ...reference(op), initialPhase: "execute" },
      { startAsync: true },
    );
    await ctx.db.patch("recoveryWorkflowOperations", operationId, {
      workflowId,
    });
    return status(op);
  },
});
export const requestCancel = mutation({
  args: refFields,
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    if (op.status === "completed" || op.status === "canceled")
      return status(op);
    await ctx.db.patch("recoveryWorkflowOperations", op._id, {
      cancelRequested: true,
    });
    return status((await ctx.db.get("recoveryWorkflowOperations", op._id))!);
  },
});
export const resume = mutation({
  args: refFields,
  returns: safeStatus,
  handler: async (ctx, args) => {
    const op = await read(ctx, args);
    const workflowStatus = await executionWorkflow.status(
      ctx,
      op.workflowId as WorkflowId,
    );
    if (workflowStatus.type === "failed") {
      const last = (
        await executionWorkflow.listSteps(ctx, op.workflowId as WorkflowId, {
          order: "desc",
          paginationOpts: { cursor: null, numItems: 1 },
        })
      ).page[0];
      if (
        last &&
        ["receipt", "finish", "completion"].includes(last.name) &&
        last.runResult?.kind === "failed"
      )
        await executionWorkflow.restart(ctx, op.workflowId as WorkflowId, {
          from: last.stepNumber,
          startAsync: true,
        });
      else {
        // A bounded/exhausted or unjournaled provider segment must never
        // replay an execute phase. Keep the same operation and money keys.
        const workflowId = await executionWorkflow.start(
          ctx,
          workflow,
          { ...reference(op), initialPhase: "reconcile" },
          { startAsync: true },
        );
        await ctx.db.patch("recoveryWorkflowOperations", op._id, {
          workflowId,
          resumeQueued: false,
          status: op.outcome ? "running" : "queued",
        });
      }
      return status((await ctx.db.get("recoveryWorkflowOperations", op._id))!);
    }
    if (
      (op.status === "unknown" || op.status === "waiting") &&
      !op.resumeQueued
    ) {
      await executionWorkflow.sendEvent(ctx, {
        workflowId: op.workflowId as WorkflowId,
        name: "reconcile",
        value: null,
      });
      await ctx.db.patch("recoveryWorkflowOperations", op._id, {
        resumeQueued: true,
      });
    }
    return status((await ctx.db.get("recoveryWorkflowOperations", op._id))!);
  },
});
