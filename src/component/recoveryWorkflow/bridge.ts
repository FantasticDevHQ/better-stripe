import { anyApi, type FunctionHandle } from "convex/server";
import { internalAction } from "../_generated/server.js";
import { refFields, phase, receipt } from "./schema.js";
import type { Infer } from "convex/values";
import { same } from "./helpers.js";
const unknown = {
  status: "unknown",
  reason: "provider_outcome_unknown",
} as const;
export const invoke = internalAction({
  args: { ...refFields, phase },
  returns: receipt,
  handler: async (ctx, args): Promise<Infer<typeof receipt>> => {
    try {
      const { phase: _phase, ...ref } = args;
      const op = await ctx.runQuery(anyApi.recoveryWorkflow.queries.saved, ref);
      if (
        !(await ctx.runMutation(
          anyApi.recoveryWorkflow.steps.beginProvider,
          args,
        ))
      )
        return { status: "canceled" };
      const request = {
        ...args,
        providerApiVersion: op.providerApiVersion,
        definitionVersion: op.definitionVersion,
      };
      const result: unknown = await ctx.runAction(
        op.provider as FunctionHandle<"action">,
        request,
      );
      if (!result || typeof result !== "object" || Array.isArray(result))
        return unknown;
      const r = result as Record<string, unknown>;
      const allowed = [
        ...Object.keys(request),
        "sourceId",
        "status",
        "outcome",
        "reason",
      ];
      if (
        Object.keys(r).some((k) => !allowed.includes(k)) ||
        !same(
          Object.fromEntries(Object.keys(request).map((k) => [k, r[k]])),
          request,
        ) ||
        r.sourceId !== op.sourceId
      )
        return unknown;
      if (
        r.status === "ready" &&
        (r.outcome === "collect" || r.outcome === "release") &&
        (op.sourceKind !== "settlement" || r.outcome === "collect")
      )
        return { status: "ready", outcome: r.outcome };
      if (r.status === "not_ready" && r.reason === "provider_pending")
        return { status: "not_ready", reason: "provider_pending" };
      return unknown;
    } catch {
      // Never allow an SDK exception, response object, or host payload into Workflow history.
      return unknown;
    }
  },
});
