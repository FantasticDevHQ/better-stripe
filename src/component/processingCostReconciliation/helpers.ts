import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { refFields, failure } from "./schema.js";
const _ref = v.object(refFields);
export type OperationRef = Infer<typeof _ref>;
export const conflict = (reason: "identity_changed" | "revision_changed") =>
  ({ status: "conflict", reason, retryable: false }) as const;
export function reference(
  op: Doc<"processingCostReconciliationOperations">,
): OperationRef {
  return {
    accountId: op.accountId,
    scopeKey: op.scopeKey,
    currency: op.currency,
    operationId: op._id,
    version: op.version,
  };
}
export function status(op: Doc<"processingCostReconciliationOperations">) {
  const ref = reference(op);
  if (op.result)
    return { ...ref, status: "completed" as const, result: op.result };
  if (op.failure) return { ...ref, ...op.failure };
  return {
    ...ref,
    status: op.status === "queued" ? ("queued" as const) : ("running" as const),
  };
}
export async function read(ctx: QueryCtx | MutationCtx, args: OperationRef) {
  const op = await ctx.db.get(
    "processingCostReconciliationOperations",
    args.operationId,
  );
  if (
    !op ||
    Object.entries(reference(op)).some(
      ([k, value]) => value !== args[k as keyof OperationRef],
    )
  )
    throw new Error("Processing-cost operation identity does not match.");
  return op;
}

export async function setFailure(
  ctx: MutationCtx,
  op: Doc<"processingCostReconciliationOperations">,
  value: Infer<typeof failure>,
) {
  await ctx.db.patch("processingCostReconciliationOperations", op._id, {
    status: value.status === "not_ready" ? "waiting" : value.status,
    failure: value,
  });
  return { ...reference(op), ...value };
}
