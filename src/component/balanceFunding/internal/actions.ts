import type { FunctionHandle } from "convex/server";
import { internalAction } from "../../_generated/server.js";
import { internal } from "../../_generated/api.js";
import { phaseRefFields, type FundingPhaseRef } from "../workflowValidators.js";
import { providerResult, type ProviderResult } from "../workflowSchema.js";
import { normalizeReceipt } from "../receipt.js";
import { phaseKey, unknown } from "../workflowState.js";
export const bridge = internalAction({
  args: phaseRefFields,
  returns: providerResult,
  handler: async (ctx, args): Promise<ProviderResult> => {
    const { phase: _phase, providerKey: _key, ...base } = args;
    const context = await ctx.runQuery(
      internal.balanceFunding.internal.queries.readContext,
      base,
    );
    if (phaseKey(context.operation, args.phase) !== args.providerKey)
      return {
        status: "conflict",
        reason: "identity_changed",
        retryable: false,
      };
    try {
      const result: unknown = await ctx.runAction(
        context.operation.execution!.providerAction as FunctionHandle<
          "action",
          FundingPhaseRef,
          unknown
        >,
        args,
      );
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "ready" &&
        "value" in result
      ) {
        const receipt = normalizeReceipt(result.value, args);
        if (receipt) {
          // Preserve positive evidence even if cancellation races this action.
          // A failed receipt write is retried as its own workflow step.
          try {
            await ctx.runMutation(
              internal.balanceFunding.internal.mutations.recordProviderReceipt,
              { ...args, receipt },
            );
          } catch {
            /* journal the validated receipt below */
          }
          return { status: "ready", value: receipt };
        }
      }
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        "reason" in result
      ) {
        const current = await ctx.runQuery(
          internal.balanceFunding.internal.queries.readContext,
          base,
        );
        if (!current.operation.execution?.[args.phase]) {
          if (
            result.status === "conflict" &&
            (result.reason === "scope_busy" ||
              result.reason === "revision_changed" ||
              result.reason === "identity_changed")
          )
            return {
              status: "conflict",
              reason: result.reason,
              retryable: false,
            };
          if (
            result.status === "rejected" &&
            (result.reason === "policy_invalid" ||
              result.reason === "unsupported_source" ||
              result.reason === "invalid_scope")
          )
            return {
              status: "rejected",
              reason: result.reason,
              retryable: false,
            };
          if (
            result.status === "not_ready" &&
            result.reason === "provider_pending"
          )
            return {
              status: "not_ready",
              reason: "provider_pending",
              retryable: true,
            };
        }
      }
    } catch {
      /* Raw host/provider errors must never enter durable history. */
    }
    await ctx.runMutation(
      internal.balanceFunding.internal.mutations.markProviderUnknown,
      args,
    );
    return unknown();
  },
});
