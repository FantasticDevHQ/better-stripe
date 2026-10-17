import { anyApi, type FunctionHandle } from "convex/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internalAction } from "../_generated/server.js";
import { refFields, observation, failure } from "./schema.js";
import { providerReceiptSchema } from "../../client/processingCostReconciliation/contracts.js";
import { same } from "../recoveryWorkflow/helpers.js";
const outcome = v.union(
  v.object({ status: v.literal("ready"), value: observation }),
  failure,
);
const unknown = {
  status: "unknown",
  reason: "provider_outcome_unknown",
  retryable: false,
} as const;
export const invoke = internalAction({
  args: refFields,
  returns: outcome,
  handler: async (ctx, args): Promise<Infer<typeof outcome>> => {
    try {
      const op = await ctx.runQuery(
        anyApi.processingCostReconciliation.queries.saved,
        args,
      );
      if (op.result) return { status: "ready", value: op.result.observation };
      if (op.failure && ["conflict", "rejected"].includes(op.failure.status))
        return op.failure;
      await ctx.runMutation(
        anyApi.processingCostReconciliation.steps.begin,
        args,
      );
      const request = {
        ...args,
        providerApiVersion: op.providerApiVersion,
        definitionVersion: op.definitionVersion,
      };
      const raw: unknown = await ctx.runAction(
        op.provider as FunctionHandle<"action">,
        request,
      );
      const parsed = providerReceiptSchema.safeParse(raw);
      if (!parsed.success) return unknown;
      const { outcome, ...echo } = parsed.data;
      return same(request, echo) ? outcome : unknown;
    } catch {
      return unknown;
    }
  },
});
