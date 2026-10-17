import type { Infer } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import type { MutationCtx } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { ref, same } from "./helpers.js";
import { normalizeReceipt } from "./receipt.js";
import { requestCancelHandler } from "./lifecycleHandlers.js";
import {
  finishFromReceiptsHandler,
  recordProviderReceiptHandler,
  phaseKey,
  FundingWorkflowError,
  readWorkflowContext,
  requireWorkflow,
  conflict,
  unknown,
} from "./workflowState.js";
import {
  workflowStartResult,
  type FundingWorkflowRef,
} from "./workflowValidators.js";
type StartResult = Infer<typeof workflowStartResult>;
const failure = (e: unknown) => {
  if (e instanceof FundingWorkflowError) return e.outcome;
  throw new Error("Balance funding workflow storage or scheduling failed.");
};
export async function startWorkflowHandler(
  ctx: MutationCtx,
  args: FundingWorkflowRef & { providerAction: string },
): Promise<StartResult> {
  try {
    const { operation } = await readWorkflowContext(ctx, args, false);
    const operationRef = ref(operation);
    const execution = operation.execution;
    if (execution) {
      requireWorkflow(
        execution.providerAction === args.providerAction &&
          execution.definitionVersion === args.definitionVersion &&
          execution.providerApiVersion === args.providerApiVersion,
        conflict("identity_changed"),
      );
      return {
        status: "accepted",
        operation: operationRef,
        ...(execution.workflowId ? { workflowId: execution.workflowId } : {}),
      };
    }
    if (operation.state === "canceled")
      return { status: "canceled", operation: operationRef };
    if (operation.state === "succeeded")
      return { status: "accepted", operation: operationRef };
    requireWorkflow(operation.state === "pending", unknown());
    const { providerAction, ...base } = args;
    const binding = {
      definitionVersion: args.definitionVersion,
      providerApiVersion: args.providerApiVersion,
      providerAction,
    };
    const workflowId = await executionWorkflow.start(
      ctx,
      internal.balanceFunding.internal.workflow.run,
      base,
      {
        startAsync: true,
        onComplete: internal.balanceFunding.internal.mutations.onComplete,
        context: base,
      },
    );
    await ctx.db.patch("balanceFundingOperations", operation._id, {
      execution: { ...binding, workflowId },
    });
    return { status: "accepted", operation: operationRef, workflowId };
  } catch (e) {
    return failure(e);
  }
}
export async function resumeWorkflowHandler(
  ctx: MutationCtx,
  args: FundingWorkflowRef,
): Promise<StartResult> {
  try {
    const { operation } = await readWorkflowContext(ctx, args);
    const workflowId = operation.execution?.workflowId as
      WorkflowId | undefined;
    requireWorkflow(workflowId, unknown("history_incomplete"));
    const accepted: StartResult = {
      status: "accepted",
      operation: ref(operation),
      workflowId,
    };
    if (operation.state === "succeeded") return accepted;
    if (operation.state === "canceled")
      return { status: "canceled", operation: ref(operation) };
    const status = await executionWorkflow
      .status(ctx, workflowId)
      .catch(() => null);
    requireWorkflow(status, unknown("history_incomplete"));
    if (status.type === "inProgress") return accepted;
    const history = await executionWorkflow.listSteps(ctx, workflowId, {
      paginationOpts: { cursor: null, numItems: 32 },
      order: "asc",
    });
    requireWorkflow(
      history.isDone && history.page.length > 0,
      unknown("history_incomplete"),
    );
    const names = new Set([
      "plan-v1",
      "create-provider-v1",
      "create-record-v1",
      "attach-provider-v1",
      "attach-record-v1",
      "finish-v1",
      "apply-provider-v1",
      "apply-record-v1",
    ]);
    requireWorkflow(
      history.page.every((s) => names.has(s.name)),
      conflict("revision_changed"),
    );
    for (const step of history.page) {
      if (
        !step.name.endsWith("-provider-v1") ||
        step.runResult?.kind !== "success"
      )
        continue;
      const phase =
        step.name === "create-provider-v1"
          ? "create"
          : step.name === "attach-provider-v1"
            ? "attach"
            : "apply";
      const providerKey = phaseKey(operation, phase);
      requireWorkflow(providerKey, conflict("identity_changed"));
      const phaseArgs = { ...args, phase, providerKey } as const;
      requireWorkflow(same(step.args, phaseArgs), conflict("identity_changed"));
      const result = step.runResult.returnValue as {
        status?: string;
        value?: unknown;
      } | null;
      if (result?.status !== "ready") continue;
      const receipt = normalizeReceipt(result.value, phaseArgs);
      requireWorkflow(receipt, conflict("identity_changed"));
      await recordProviderReceiptHandler(ctx, { ...phaseArgs, receipt });
    }
    const { operation: reconciled } = await readWorkflowContext(ctx, args);
    const failed = history.page.find(
      (s) => s.runResult?.kind === "failed" || s.runResult?.kind === "canceled",
    );
    const uncertain = history.page.find(
      (s) =>
        s.name.endsWith("-provider-v1") &&
        s.runResult?.kind === "success" &&
        (s.runResult.returnValue as { status?: string } | null)?.status !==
          "ready",
    );
    const from = failed?.name ?? uncertain?.name;
    if (
      !from &&
      ((reconciled.kind === "prepare" &&
        reconciled.execution?.create?.state === "succeeded" &&
        reconciled.execution.attach?.state === "succeeded") ||
        (reconciled.kind === "apply" &&
          reconciled.execution?.apply?.state === "succeeded"))
    ) {
      await finishFromReceiptsHandler(ctx, args);
      return accepted;
    }
    requireWorkflow(from, unknown("history_incomplete"));
    await executionWorkflow.restart(ctx, workflowId, {
      from,
      startAsync: true,
    });
    return accepted;
  } catch (e) {
    return failure(e);
  }
}
export async function cancelWorkflowHandler(
  ctx: MutationCtx,
  args: FundingWorkflowRef,
) {
  const { operation } = await readWorkflowContext(ctx, args);
  const updated = await requestCancelHandler(ctx, ref(operation));
  const workflowId = operation.execution?.workflowId as WorkflowId | undefined;
  if (
    workflowId &&
    (await executionWorkflow.status(ctx, workflowId)).type === "inProgress"
  )
    await executionWorkflow.cancel(ctx, workflowId);
  return {
    ...ref(updated),
    state: updated.state,
    cancelRequested: updated.cancelRequested,
    ...(updated.failureCode ? { failureCode: updated.failureCode } : {}),
  };
}
