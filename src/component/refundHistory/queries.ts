import { refundCommandEvidenceValidator } from "./commandEvidenceValidator.js";
import { readRefundCommandEvidence } from "./commandEvidence.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";

import { query, type QueryCtx } from "../_generated/server.js";
import schema from "../schema.js";
import {
  refundDocValidator,
  refundStatusValidator,
  type RefundStatus,
} from "../connect/validators.js";

/** Host-authorized scopes are conjunctive; use the package React pagination binding. */
export const paginateRefunds = query({
  args: {
    accountId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.optional(refundStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(refundDocValidator),
  handler: (ctx, args) => {
    const { paginationOpts } = args;
    if (
      !Number.isSafeInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 100
    )
      throw new Error(
        "Refund history page size must be an integer from 1 to 100",
      );
    return scopedRefunds(ctx, args)
      .order("desc")
      .paginate({
        ...paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      });
  },
});

function scopedRefunds(
  ctx: QueryCtx,
  args: {
    accountId?: string;
    stripePaymentIntentId?: string;
    status?: RefundStatus;
  },
) {
  const { accountId, stripePaymentIntentId, status } = args;
  const refunds = paginator(ctx.db, schema).query("refunds");
  if (
    accountId !== undefined &&
    stripePaymentIntentId !== undefined &&
    status === undefined
  )
    return refunds.withIndex(
      "by_account_id_and_stripe_payment_intent_id",
      (q) =>
        q
          .eq("accountId", accountId)
          .eq("stripePaymentIntentId", stripePaymentIntentId),
    );
  if (
    accountId !== undefined &&
    stripePaymentIntentId !== undefined &&
    status !== undefined
  )
    return refunds.withIndex(
      "by_account_id_and_stripe_payment_intent_id_and_status",
      (q) =>
        q
          .eq("accountId", accountId)
          .eq("stripePaymentIntentId", stripePaymentIntentId)
          .eq("status", status),
    );
  if (accountId !== undefined && status !== undefined)
    return refunds.withIndex("by_account_id_and_status", (q) =>
      q.eq("accountId", accountId).eq("status", status),
    );
  if (stripePaymentIntentId !== undefined && status !== undefined)
    return refunds.withIndex("by_payment_intent_id_and_status", (q) =>
      q.eq("stripePaymentIntentId", stripePaymentIntentId).eq("status", status),
    );
  if (accountId !== undefined)
    return refunds.withIndex("by_account_id", (q) =>
      q.eq("accountId", accountId),
    );
  if (stripePaymentIntentId !== undefined)
    return refunds.withIndex("by_stripe_payment_intent_id", (q) =>
      q.eq("stripePaymentIntentId", stripePaymentIntentId),
    );
  if (status !== undefined)
    return refunds.withIndex("by_status", (q) => q.eq("status", status));
  return refunds;
}

/** Exact command evidence is read-only and never authorizes a provider retry. */
export const getRefundCommandEvidence = query({
  args: {
    commandKey: v.string(),
    accountId: v.string(),
    stripePaymentIntentId: v.string(),
    stripeChargeId: v.string(),
    currency: v.string(),
  },
  returns: refundCommandEvidenceValidator,
  handler: readRefundCommandEvidence,
});
