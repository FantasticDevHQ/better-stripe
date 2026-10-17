import { v } from "convex/values";
import { internalMutation } from "../../_generated/server.js";
import { vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import {
  workflowRef,
  workflowRefFields,
  phaseRefFields,
} from "../workflowValidators.js";
import { provisioningReceipt } from "../workflowSchema.js";
import {
  finishFromReceiptsHandler,
  recordProviderReceiptHandler,
  markProviderUnknownHandler,
  readWorkflowContext,
} from "../workflowState.js";
export const recordProviderReceipt = internalMutation({
  args: { ...phaseRefFields, receipt: provisioningReceipt },
  returns: v.null(),
  handler: recordProviderReceiptHandler,
});
export const markProviderUnknown = internalMutation({
  args: phaseRefFields,
  returns: v.null(),
  handler: markProviderUnknownHandler,
});
export const finishFromReceipts = internalMutation({
  args: workflowRefFields,
  returns: v.null(),
  handler: finishFromReceiptsHandler,
});
export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: workflowRef,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { operation } = await readWorkflowContext(ctx, args.context);
    if (
      operation.execution?.workflowId !== args.workflowId ||
      ["succeeded", "failed", "canceled"].includes(operation.state)
    )
      return null;
    const unsettled = [
      operation.execution?.create,
      operation.execution?.attach,
      operation.execution?.apply,
    ].some((phase) => phase?.state === "running" || phase?.state === "unknown");
    if (
      args.result.kind !== "success" &&
      (unsettled ||
        (args.result.kind === "canceled" &&
          [
            operation.execution?.create,
            operation.execution?.attach,
            operation.execution?.apply,
          ].some(Boolean)))
    )
      await ctx.db.patch("balanceFundingOperations", operation._id, {
        state: "unknown",
      });
    return null;
  },
});
