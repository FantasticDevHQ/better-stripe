import { financialRetryDecision } from "../../client/financialOutcomes/retry.js";
import { anyApi } from "convex/server";
import { executionWorkflow } from "../durableExecution/runtime.js";
import { refFields, safeStatus, phase as phaseValidator } from "./schema.js";
import type { Infer } from "convex/values";
export const run = executionWorkflow
  .define({
    args: { ...refFields, initialPhase: phaseValidator },
    returns: safeStatus,
  })
  .handler(async (step, input): Promise<Infer<typeof safeStatus>> => {
    const { initialPhase, ...args } = input;
    const saved = await step.runQuery(
      anyApi.recoveryWorkflow.queries.saved,
      args,
    );
    const finish = async (): Promise<Infer<typeof safeStatus>> => {
      for (let batch = 0; batch < 20; batch++) {
        if (
          await step.runMutation(anyApi.recoveryWorkflow.steps.finish, args, {
            name: "finish",
          })
        )
          return step.runMutation(
            anyApi.recoveryWorkflow.steps.complete,
            args,
            { name: "completion" },
          );
      }
      throw new Error("Recovery finish batch budget exhausted.");
    };
    if (saved.outcome) return finish();
    let phase: "execute" | "reconcile" = initialPhase;
    let attempts = 0;
    for (let turn = 0; turn < 20; turn++) {
      const result = await step.runAction(
        anyApi.recoveryWorkflow.bridge.invoke,
        { ...args, phase },
        { name: `provider-${phase}-${turn}`, retry: false },
      );
      const status = await step.runMutation(
        anyApi.recoveryWorkflow.steps.saveReceipt,
        { ...args, result },
        { name: "receipt" },
      );
      if (result.status === "canceled") return status;
      if (result.status === "ready") return finish();
      phase = "reconcile";
      const retry = financialRetryDecision(
        result.status === "not_ready"
          ? { status: "not_ready", reason: "provider_pending", retryable: true }
          : {
              status: "unknown",
              reason: "provider_outcome_unknown",
              retryable: false,
            },
        attempts,
        {
          maxRetries: saved.maxAttempts - 1,
          initialDelayMs: saved.retryDelayMs,
          maxDelayMs: saved.retryDelayMs,
        },
      );
      if (!status.cancelRequested && retry.status === "retry") {
        attempts = retry.nextAttempt;
        await step.sleep(retry.delayMs);
      } else {
        await step.awaitEvent({ name: "reconcile" });
        attempts = 0;
      }
    }
    throw new Error("Recovery reconciliation budget exhausted.");
  });
