import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { query } from "../_generated/server.js";
import {
  refundDocValidator,
  refundStatusValidator,
} from "../connect/validators.js";

/** Host-authorized scopes are conjunctive. Each request performs one bounded paginate. */
export const paginateRefunds = query({
  args: {
    accountId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.optional(refundStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(refundDocValidator),
  handler: (ctx, args) => {
    const { accountId, stripePaymentIntentId, status, paginationOpts } = args;
    if (
      !Number.isSafeInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 100
    )
      throw new Error(
        "Refund history page size must be an integer from 1 to 100",
      );
    const refunds = ctx.db.query("refunds");
    if (
      accountId !== undefined &&
      stripePaymentIntentId !== undefined &&
      status === undefined
    )
      return refunds
        .withIndex("by_account_id_and_stripe_payment_intent_id", (q) =>
          q
            .eq("accountId", accountId)
            .eq("stripePaymentIntentId", stripePaymentIntentId),
        )
        .order("desc")
        .paginate(paginationOpts);
    if (
      accountId !== undefined &&
      stripePaymentIntentId !== undefined &&
      status !== undefined
    )
      return refunds
        .withIndex(
          "by_account_id_and_stripe_payment_intent_id_and_status",
          (q) =>
            q
              .eq("accountId", accountId)
              .eq("stripePaymentIntentId", stripePaymentIntentId)
              .eq("status", status),
        )
        .order("desc")
        .paginate(paginationOpts);
    if (accountId !== undefined && status !== undefined)
      return refunds
        .withIndex("by_account_id_and_status", (q) =>
          q.eq("accountId", accountId).eq("status", status),
        )
        .order("desc")
        .paginate(paginationOpts);
    if (stripePaymentIntentId !== undefined && status !== undefined)
      return refunds
        .withIndex("by_payment_intent_id_and_status", (q) =>
          q
            .eq("stripePaymentIntentId", stripePaymentIntentId)
            .eq("status", status),
        )
        .order("desc")
        .paginate(paginationOpts);
    if (accountId !== undefined)
      return refunds
        .withIndex("by_account_id", (q) => q.eq("accountId", accountId))
        .order("desc")
        .paginate(paginationOpts);
    if (stripePaymentIntentId !== undefined)
      return refunds
        .withIndex("by_stripe_payment_intent_id", (q) =>
          q.eq("stripePaymentIntentId", stripePaymentIntentId),
        )
        .order("desc")
        .paginate(paginationOpts);
    if (status !== undefined)
      return refunds
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .paginate(paginationOpts);
    return refunds.order("desc").paginate(paginationOpts);
  },
});
