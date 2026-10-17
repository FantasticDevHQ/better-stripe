import { createFunctionHandle } from "convex/server";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { componentRef } from "../webhooks/helpers.js";
import { operationRef } from "./contracts.js";
import type {
  RecoveryOperationRef,
  RecoveryOperationStatus,
  RecoveryProviderRequest,
  RecoveryStartOptions,
  RecoveryStartResult,
} from "./contracts.js";
import {
  executeRecoveryProvider,
  type RecoveryProviderOptions,
} from "./provider.js";
export abstract class RecoveryWorkflowClient {
  protected abstract readonly component: Component;
  /** Authorize the full scope and allocation in the host mutation. requestKey is immutable per component. */
  async startGroup(
    ctx: RunCtx,
    opts: RecoveryStartOptions,
  ): Promise<RecoveryStartResult> {
    const { provider, completion, ...args } = opts;
    return (await runMutationOrThrow(
      ctx,
      componentRef(this.component, "recoveryWorkflow/mutations/start"),
      {
        ...args,
        provider: await createFunctionHandle(provider),
        ...(completion
          ? { completion: await createFunctionHandle(completion) }
          : {}),
        maxAttempts: opts.maxAttempts ?? 3,
        retryDelayMs: opts.retryDelayMs ?? 1000,
      },
    )) as RecoveryStartResult;
  }
  getGroupOperation(
    ctx: RunCtx,
    op: RecoveryOperationRef,
  ): Promise<RecoveryOperationStatus> {
    return ctx.runQuery(
      componentRef(this.component, "recoveryWorkflow/queries/get"),
      operationRef(op),
    ) as Promise<RecoveryOperationStatus>;
  }
  resumeGroup(
    ctx: RunCtx,
    op: RecoveryOperationRef,
  ): Promise<RecoveryOperationStatus> {
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "recoveryWorkflow/mutations/resume"),
      operationRef(op),
    ) as Promise<RecoveryOperationStatus>;
  }
  requestGroupCancel(
    ctx: RunCtx,
    op: RecoveryOperationRef,
  ): Promise<RecoveryOperationStatus> {
    return runMutationOrThrow(
      ctx,
      componentRef(this.component, "recoveryWorkflow/mutations/requestCancel"),
      operationRef(op),
    ) as Promise<RecoveryOperationStatus>;
  }
  /** Call only inside the registered internal host action. Inject credentials from runtime env, never workflow args. */
  executeGroupProvider(
    ctx: RunCtx,
    request: RecoveryProviderRequest,
    options: RecoveryProviderOptions,
  ) {
    return executeRecoveryProvider(this.component, ctx, request, options);
  }
}
