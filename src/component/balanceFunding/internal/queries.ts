import { v } from "convex/values";
import { internalQuery } from "../../_generated/server.js";
import { operationDoc, preparationDoc } from "../schema.js";
import { workflowRefFields } from "../workflowValidators.js";
import { readWorkflowContext } from "../workflowState.js";
export const readContext = internalQuery({
  args: workflowRefFields,
  returns: v.object({ operation: operationDoc, preparation: preparationDoc }),
  handler: (ctx, args) => readWorkflowContext(ctx, args),
});
export const plan = internalQuery({
  args: workflowRefFields,
  returns: v.object({
    createKey: v.optional(v.string()),
    attachKey: v.optional(v.string()),
    applyKey: v.string(),
    kind: v.union(v.literal("prepare"), v.literal("apply")),
  }),
  handler: async (ctx, args) => {
    const { operation } = await readWorkflowContext(ctx, args);
    return {
      kind: operation.kind,
      applyKey: operation.enabled
        ? operation.providerKeys.enable
        : operation.providerKeys.disable,
      ...(operation.providerKeys.create
        ? { createKey: operation.providerKeys.create }
        : {}),
      ...(operation.providerKeys.attach
        ? { attachKey: operation.providerKeys.attach }
        : {}),
    };
  },
});
