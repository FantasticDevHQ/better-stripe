import {
  observeProcessingCostProvider,
  type ProcessingCostProviderOptions,
} from "./provider.js";
import type { ProcessingCostProviderRequest } from "./contracts.js";
import { createFunctionHandle } from "convex/server";
import { RecoveryWorkflowClient } from "../recoveryWorkflow/client.js";
import type { RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { processingCostRef } from "./contracts.js";
import type {
  ProcessingCostOperationRef,
  ProcessingCostOperationStatus,
  ProcessingCostStartOptions,
  ProcessingCostStartResult,
} from "./contracts.js";
export abstract class ProcessingCostReconciliationClient extends RecoveryWorkflowClient {
  /** Host authorizes the original source, scope, liability policy and both expected revisions. */
  async startProcessingCostReconciliation(
    ctx: RunCtx,
    options: ProcessingCostStartOptions,
  ): Promise<ProcessingCostStartResult> {
    const { provider, projection, importHook, ...args } = options;
    return (await runMutationOrThrow(
      ctx,
      componentRef(
        this.component,
        "processingCostReconciliation/mutations/start",
      ),
      {
        ...args,
        provider: await createFunctionHandle(provider),
        ...(projection
          ? { projection: await createFunctionHandle(projection) }
          : {}),
        ...(importHook
          ? { importHook: await createFunctionHandle(importHook) }
          : {}),
        maxAttempts: options.maxAttempts ?? 3,
        retryDelayMs: options.retryDelayMs ?? 1000,
      },
    )) as ProcessingCostStartResult;
  }
  getProcessingCostReconciliation(
    ctx: RunCtx,
    op: ProcessingCostOperationRef,
  ): Promise<ProcessingCostOperationStatus> {
    return ctx.runQuery(
      componentRef(this.component, "processingCostReconciliation/queries/get"),
      processingCostRef(op),
    ) as Promise<ProcessingCostOperationStatus>;
  }
  resumeProcessingCostReconciliation(
    ctx: RunCtx,
    op: ProcessingCostOperationRef,
  ): Promise<ProcessingCostOperationStatus> {
    return runMutationOrThrow(
      ctx,
      componentRef(
        this.component,
        "processingCostReconciliation/mutations/resume",
      ),
      processingCostRef(op),
    ) as Promise<ProcessingCostOperationStatus>;
  }
  /** Registered internal host action only. Supply the secret at execution, never in workflow arguments. */
  observeProcessingCosts(
    ctx: RunCtx,
    request: ProcessingCostProviderRequest,
    options: ProcessingCostProviderOptions,
  ) {
    return observeProcessingCostProvider(this.component, ctx, request, options);
  }
}
