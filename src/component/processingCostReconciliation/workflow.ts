import { anyApi } from "convex/server";
import type { Infer } from "convex/values";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { refFields, safeStatus } from "./schema.js";
import { financialRetryDecision } from "../../client/financialOutcomes/retry.js";
export const run = executionWorkflow
  .define({ args: refFields, returns: safeStatus })
  .handler(async (step, args): Promise<Infer<typeof safeStatus>> => {
    const op = await step.runQuery(
      anyApi.processingCostReconciliation.queries.saved,
      args,
    );
    for (let attempt = 0; attempt < op.maxAttempts; attempt++) {
      const observed = await step.runAction(
        anyApi.processingCostReconciliation.bridge.invoke,
        args,
        { name: `observe-${attempt}`, retry: false },
      );
      const state =
        observed.status === "ready"
          ? await step.runMutation(
              anyApi.processingCostReconciliation.steps.apply,
              { ...args, observation: observed.value },
              { name: "apply" },
            )
          : await step.runMutation(
              anyApi.processingCostReconciliation.steps.unavailable,
              { ...args, outcome: observed },
            );
      if (!["not_ready", "unknown"].includes(state.status)) return state;
      if (state.status !== "not_ready" && state.status !== "unknown")
        return state;
      const decision = financialRetryDecision(
        {
          status: state.status,
          reason: state.reason,
          retryable: state.retryable,
        },
        attempt,
        {
          maxRetries: op.maxAttempts - 1,
          initialDelayMs: op.retryDelayMs,
          maxDelayMs: op.retryDelayMs,
        },
      );
      if (decision.status === "stop") return state;
      await step.sleep(decision.delayMs);
    }
    throw new Error("Processing-cost observation budget exhausted.");
  });
