import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import type {
  FundingWorkflowRef,
  FundingPhaseRef,
} from "./workflowValidators.js";
import {
  FUNDING_WORKFLOW_VERSION,
  type WorkflowUnavailable,
  type ProvisioningReceipt,
} from "./workflowSchema.js";
import { finishPreparationHandler } from "./preparationHandlers.js";
import { finishHandler } from "./stateHandlers.js";
import { ref, same } from "./helpers.js";

export const unknown = (
  reason:
    | "provider_outcome_unknown"
    | "history_incomplete" = "provider_outcome_unknown",
): WorkflowUnavailable => ({ status: "unknown", reason, retryable: false });
export const conflict = (
  reason: "identity_changed" | "revision_changed" | "scope_busy",
): WorkflowUnavailable => ({ status: "conflict", reason, retryable: false });
export class FundingWorkflowError extends Error {
  constructor(readonly outcome: WorkflowUnavailable) {
    super("Balance funding workflow requires reconciliation.");
  }
}
export function requireWorkflow(
  value: unknown,
  outcome: WorkflowUnavailable,
): asserts value {
  if (!value) throw new FundingWorkflowError(outcome);
}
export async function readWorkflowContext(
  ctx: QueryCtx | MutationCtx,
  args: FundingWorkflowRef,
  binding = true,
) {
  requireWorkflow(
    args.definitionVersion === FUNDING_WORKFLOW_VERSION,
    conflict("revision_changed"),
  );
  const operation = await ctx.db.get(
    "balanceFundingOperations",
    args.operationId,
  );
  requireWorkflow(
    operation &&
      operation.accountId === args.accountId &&
      operation.scopeKey === args.scopeKey &&
      operation.version === args.version,
    conflict("identity_changed"),
  );
  const preparation = await ctx.db.get(
    "balanceFundingPreparations",
    operation.preparationId,
  );
  requireWorkflow(
    preparation &&
      preparation.accountId === args.accountId &&
      preparation.scopeKey === args.scopeKey &&
      preparation.preparation.stripeSubscriptionId ===
        args.stripeSubscriptionId &&
      preparation.providerApiVersion === args.providerApiVersion,
    conflict("identity_changed"),
  );
  if (binding)
    requireWorkflow(
      operation.execution &&
        operation.execution.definitionVersion === args.definitionVersion &&
        operation.execution.providerApiVersion === args.providerApiVersion,
      conflict("revision_changed"),
    );
  return { operation, preparation };
}
function active(context: Awaited<ReturnType<typeof readWorkflowContext>>) {
  requireWorkflow(
    context.preparation.activeOperationId === context.operation._id &&
      context.preparation.operationVersion === context.operation.version,
    conflict("revision_changed"),
  );
}
export async function claimProviderPhaseHandler(
  ctx: MutationCtx,
  args: FundingPhaseRef,
) {
  const context = await readWorkflowContext(ctx, args);
  const { operation: op, preparation } = context;
  requireWorkflow(
    (op.kind === "prepare" && args.phase !== "apply") ||
      (op.kind === "apply" && args.phase === "apply"),
    {
      status: "rejected",
      reason: "unsupported_source",
      retryable: false,
    },
  );
  requireWorkflow(
    phaseKey(op, args.phase) === args.providerKey,
    conflict("identity_changed"),
  );
  const phase = op.execution![args.phase];
  if (phase?.state === "succeeded" && phase.receipt)
    return { status: "ready" as const, value: phase.receipt };
  active(context);
  if (op.state === "canceled" || op.state === "failed") return unknown();
  const method = op.execution!.create?.receipt?.paymentMethodId;
  if (phase) {
    if (args.phase === "create" || (args.phase === "attach" && !method))
      return unknown();
    return {
      status: "claimed" as const,
      mode: "reconcile" as const,
      ...(method ? { paymentMethodId: method } : {}),
    };
  }
  if (op.cancelRequested || op.state === "unknown") return unknown();
  if (preparation.startsPaused) return conflict("scope_busy");
  if (args.phase === "attach") requireWorkflow(method, unknown());
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: "running",
    execution: {
      ...op.execution!,
      [args.phase]: { state: "running" as const },
    },
  });
  return {
    status: "claimed" as const,
    mode: "execute" as const,
    ...(method ? { paymentMethodId: method } : {}),
  };
}
export async function recordProviderReceiptHandler(
  ctx: MutationCtx,
  args: FundingPhaseRef & { receipt: ProvisioningReceipt },
) {
  const context = await readWorkflowContext(ctx, args);
  const { operation: op } = context;
  requireWorkflow(
    phaseKey(op, args.phase) === args.providerKey,
    conflict("identity_changed"),
  );
  const receipt = args.receipt;
  requireWorkflow(
    receipt.phase === args.phase &&
      receipt.customerAccount === args.accountId &&
      receipt.stripeSubscriptionId === args.stripeSubscriptionId &&
      receipt.providerApiVersion === args.providerApiVersion &&
      (args.phase === "apply" || !!receipt.paymentMethodId?.trim()),
    conflict("identity_changed"),
  );
  if (args.phase === "attach")
    requireWorkflow(
      op.execution!.create?.receipt?.paymentMethodId ===
        receipt.paymentMethodId,
      conflict("identity_changed"),
    );
  if (args.phase === "apply") {
    requireWorkflow(
      receipt.enabled === op.enabled &&
        receipt.paymentMethodId ===
          (op.enabled
            ? context.preparation.preparation.paymentMethodId
            : context.preparation.preparation.previousPaymentMethodId) &&
        same(
          receipt.paymentMethodTypes,
          op.enabled
            ? ["stripe_balance"]
            : context.preparation.preparation.previousPaymentMethodTypes,
        ),
      conflict("identity_changed"),
    );
  }
  const phase = op.execution![args.phase];
  requireWorkflow(phase, unknown());
  if (phase.receipt) {
    requireWorkflow(same(phase.receipt, receipt), conflict("identity_changed"));
    return null;
  }
  active(context);
  requireWorkflow(
    op.state !== "canceled" && op.state !== "failed",
    conflict("revision_changed"),
  );
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: op.cancelRequested ? op.state : "running",
    execution: {
      ...op.execution!,
      [args.phase]: { state: "succeeded" as const, receipt },
    },
  });
  return null;
}
export async function markProviderUnknownHandler(
  ctx: MutationCtx,
  args: FundingPhaseRef,
) {
  const context = await readWorkflowContext(ctx, args);
  const { operation: op } = context;
  requireWorkflow(
    phaseKey(op, args.phase) === args.providerKey,
    conflict("identity_changed"),
  );
  if (["succeeded", "canceled", "failed"].includes(op.state)) return null;
  active(context);
  const phase = op.execution![args.phase];
  if (phase?.receipt) return null;
  await ctx.db.patch("balanceFundingOperations", op._id, {
    state: "unknown",
    execution: {
      ...op.execution!,
      [args.phase]: { state: "unknown" as const },
    },
  });
  return null;
}
export async function finishFromReceiptsHandler(
  ctx: MutationCtx,
  args: FundingWorkflowRef,
) {
  const context = await readWorkflowContext(ctx, args);
  const { operation: op, preparation } = context;
  if (op.state === "succeeded") return null;
  if (op.kind === "apply") {
    const receipt = op.execution!.apply?.receipt;
    requireWorkflow(
      receipt &&
        op.execution!.apply?.state === "succeeded" &&
        receipt.enabled === op.enabled &&
        receipt.paymentMethodTypes !== undefined,
      unknown(),
    );
    await finishHandler(ctx, {
      ...ref(op),
      enabled: op.enabled,
      receipt: {
        customerAccount: receipt.customerAccount,
        stripeSubscriptionId: receipt.stripeSubscriptionId,
        paymentMethodId: receipt.paymentMethodId,
        paymentMethodTypes: receipt.paymentMethodTypes,
        providerApiVersion: receipt.providerApiVersion,
      },
    });
    return null;
  }
  const created = op.execution!.create?.receipt;
  const attached = op.execution!.attach?.receipt;
  requireWorkflow(
    created &&
      attached &&
      created.paymentMethodId === attached.paymentMethodId &&
      op.execution!.create?.state === "succeeded" &&
      op.execution!.attach?.state === "succeeded",
    unknown(),
  );
  await finishPreparationHandler(ctx, {
    ...ref(op),
    preparation: {
      ...preparation.preparation,
      paymentMethodId: attached.paymentMethodId!,
    },
    providerApiVersion: args.providerApiVersion,
  });
  return null;
}

export function phaseKey(
  op: {
    providerKey: string;
    enabled: boolean;
    providerKeys: {
      create?: string;
      attach?: string;
      enable: string;
      disable: string;
    };
  },
  phase: "create" | "attach" | "apply",
) {
  return phase === "apply"
    ? op.enabled
      ? op.providerKeys.enable
      : op.providerKeys.disable
    : op.providerKeys[phase];
}
