import type { Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import { generateIdempotencyKey } from "../lib/idempotency.js";
import type { snapshot } from "./validators.js";

export function validateIdentity(input: {
  stripeRefundId: string;
  apiContext: string;
}) {
  if (
    typeof input.stripeRefundId !== "string" ||
    typeof input.apiContext !== "string" ||
    !/^re_[A-Za-z0-9_]{1,252}$/.test(input.stripeRefundId) ||
    (input.apiContext !== "platform" &&
      !/^acct_[A-Za-z0-9_]{1,250}$/.test(input.apiContext))
  )
    throw new Error("Invalid refund synchronization identity or API scope.");
}
export async function claimByRefund(
  ctx: QueryCtx | MutationCtx,
  stripeRefundId: string,
) {
  const rows = await ctx.db
    .query("refundSyncClaims")
    .withIndex("by_stripe_refund_id", (q) =>
      q.eq("stripeRefundId", stripeRefundId),
    )
    .take(2);
  if (rows.length > 1) throw new Error("Refund synchronization is ambiguous.");
  return rows[0] ?? null;
}
export async function refundById(
  ctx: QueryCtx | MutationCtx,
  stripeRefundId: string,
) {
  const rows = await ctx.db
    .query("refunds")
    .withIndex("by_stripe_refund_id", (q) =>
      q.eq("stripeRefundId", stripeRefundId),
    )
    .take(2);
  if (rows.length > 1) throw new Error("Refund identity is ambiguous.");
  return rows[0] ?? null;
}
export function validateSnapshot(row: Infer<typeof snapshot>) {
  if (
    typeof row.stripeRefundId !== "string" ||
    typeof row.stripePaymentIntentId !== "string" ||
    typeof row.stripeChargeId !== "string" ||
    typeof row.currency !== "string" ||
    !/^re_[A-Za-z0-9_]{1,252}$/.test(row.stripeRefundId) ||
    !/^pi_[A-Za-z0-9_]{1,252}$/.test(row.stripePaymentIntentId) ||
    !/^ch_[A-Za-z0-9_]{1,252}$/.test(row.stripeChargeId) ||
    !Number.isSafeInteger(row.amount) ||
    row.amount < 0 ||
    !/^[a-z]{3}$/.test(row.currency) ||
    (row.accountId !== undefined &&
      !/^acct_[A-Za-z0-9_]{1,250}$/.test(row.accountId))
  )
    throw new Error("Invalid original refund snapshot.");
}
export function assertOriginal(
  existing: Doc<"refunds"> | null,
  row: Infer<typeof snapshot>,
) {
  if (
    existing &&
    (existing.amount !== row.amount ||
      existing.currency !== row.currency ||
      (existing.stripePaymentIntentId !== undefined &&
        existing.stripePaymentIntentId !== row.stripePaymentIntentId) ||
      (existing.stripeChargeId !== undefined &&
        existing.stripeChargeId !== row.stripeChargeId) ||
      (existing.accountId !== undefined &&
        existing.accountId !== row.accountId))
  )
    throw new Error(
      "Original refund identity, money or merchant does not match.",
    );
}
export function fingerprint(row: Infer<typeof snapshot> | Doc<"refunds">) {
  return generateIdempotencyKey("refund-sync", {
    snapshot: [
      row.stripeRefundId,
      row.stripePaymentIntentId,
      row.stripeChargeId,
      row.accountId,
      row.amount,
      row.currency,
      row.status,
      row.reason,
      row.failureReason,
      Object.entries(row.metadata ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ],
  });
}
