import type { QueryCtx } from "../_generated/server.js";
import {
  assertRefundCommandScope,
  type RefundCommandScope,
} from "../../shared/refundCommandScope.js";

/** Bounded global normalization and exact-key proof, never a provider history or retry claim. */
export async function readRefundCommandEvidence(
  ctx: QueryCtx,
  scope: RefundCommandScope,
) {
  assertRefundCommandScope(scope);
  const legacy = await ctx.db
    .query("refunds")
    .withIndex("by_refund_command_normalization_version", (q) =>
      q.eq("refundCommandNormalizationVersion", undefined),
    )
    .take(1);
  if (legacy.length)
    return {
      status: "unavailable" as const,
      reason: "normalization_incomplete" as const,
    };
  const rows = await ctx.db
    .query("refunds")
    .withIndex("by_refund_command_key", (q) =>
      q.eq("refundCommandKey", scope.commandKey),
    )
    .take(2);
  if (rows.length > 1)
    return { status: "unavailable" as const, reason: "ambiguous" as const };
  const row = rows[0];
  if (!row)
    return { status: "unavailable" as const, reason: "missing" as const };
  if (row.refundCommandConflict)
    return {
      status: "unavailable" as const,
      reason: "correlation_conflict" as const,
    };
  if (
    row.accountId !== scope.accountId ||
    row.stripePaymentIntentId !== scope.stripePaymentIntentId ||
    row.stripeChargeId !== scope.stripeChargeId ||
    row.currency !== scope.currency
  )
    return {
      status: "unavailable" as const,
      reason: "scope_mismatch" as const,
    };
  if (
    !/^re_[A-Za-z0-9_]{1,252}$/.test(row.stripeRefundId) ||
    !Number.isSafeInteger(row.amount) ||
    row.amount <= 0 ||
    !Number.isSafeInteger(row.refundCommandObservedAt) ||
    (row.refundCommandObservedAt ?? -1) < 0 ||
    (row.refundCommandObservedAt ?? Infinity) > Date.now()
  )
    return {
      status: "unavailable" as const,
      reason: "invalid_receipt" as const,
    };
  const identity = await ctx.db
    .query("refunds")
    .withIndex("by_stripe_refund_id", (q) =>
      q.eq("stripeRefundId", row.stripeRefundId),
    )
    .take(2);
  if (identity.length !== 1 || identity[0]?._id !== row._id)
    return { status: "unavailable" as const, reason: "ambiguous" as const };
  return { status: "observed" as const, refund: row };
}
