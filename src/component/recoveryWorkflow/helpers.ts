import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { refFields } from "./schema.js";
const _ref = v.object(refFields);
export type OperationRef = Infer<typeof _ref>;
export const identityConflict = {
  status: "conflict",
  reason: "identity_changed",
  retryable: false,
} as const;
export function reference(op: Doc<"recoveryWorkflowOperations">): OperationRef {
  return {
    accountId: op.accountId,
    scopeKey: op.scopeKey,
    currency: op.currency,
    groupKey: op.groupKey,
    operationId: op._id,
    version: op.version,
  };
}
export function status(op: Doc<"recoveryWorkflowOperations">) {
  return {
    ...reference(op),
    sourceKind: op.sourceKind,
    sourceId: op.sourceId,
    status: op.status,
    cancelRequested: op.cancelRequested,
    ...(op.outcome ? { outcome: op.outcome } : {}),
  };
}
export async function read(ctx: QueryCtx | MutationCtx, args: OperationRef) {
  const op = await ctx.db.get("recoveryWorkflowOperations", args.operationId);
  if (
    !op ||
    Object.entries(reference(op)).some(
      ([k, value]) => value !== args[k as keyof OperationRef],
    )
  )
    throw new Error("Recovery operation identity does not match.");
  return op;
}
/** Stable object ordering without admitting arbitrary durable caller payloads. */
export function same(a: unknown, b: unknown): boolean {
  const canonical = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canonical)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : x;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
