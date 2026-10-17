import type { ObjectType } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";
import { refundCommandBinding } from "../refundHistory/commandBinding.js";
import { paymentSeller } from "../lib/paymentSeller.js";
import { refundFields } from "./validators.js";

/** Existing refund write and denormalization, shared in the caller's transaction. */
export async function writeRefund(
  ctx: MutationCtx,
  args: ObjectType<typeof refundFields>,
) {
  const existing = await ctx.db
    .query("refunds")
    .withIndex("by_stripe_refund_id", (q) =>
      q.eq("stripeRefundId", args.stripeRefundId),
    )
    .first();

  const accountId =
    args.accountId ?? (await paymentSeller(ctx, args.stripePaymentIntentId));
  const record = {
    ...args,
    ...(accountId ? { accountId } : {}),
    ...refundCommandBinding(existing, args, Date.now()),
  };
  if (existing) {
    await ctx.db.patch("refunds", existing._id, record);
  } else {
    await ctx.db.insert("refunds", record);
  }

  // Denormalize cumulative refund state onto the linked `payments` row so
  // consumers can answer "is this payment whole?" in one read. Runs in the
  // same transaction as the refund upsert.
  const paymentIntentId = args.stripePaymentIntentId;
  if (paymentIntentId) {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_stripe_payment_intent_id", (q) =>
        q.eq("stripePaymentIntentId", paymentIntentId),
      )
      .first();

    if (payment) {
      // Preserve the complete legacy cumulative calculation. Failed/canceled
      // history is not cardinality-bounded; native resource errors abort atomically.
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      const refunds = await ctx.db
        .query("refunds")
        .withIndex("by_stripe_payment_intent_id", (q) =>
          q.eq("stripePaymentIntentId", paymentIntentId),
        )
        .collect();

      // Money is considered returned for any refund that isn't failed or
      // canceled (matches Stripe's Charge.amount_refunded semantics).
      const refundedAmount = refunds
        .filter((r) => r.status !== "failed" && r.status !== "canceled")
        .reduce((sum, r) => sum + r.amount, 0);

      const refundStatus =
        refundedAmount <= 0
          ? undefined
          : refundedAmount >= payment.amount
            ? ("fully_refunded" as const)
            : ("partially_refunded" as const);

      await ctx.db.patch("payments", payment._id, {
        refundedAmount,
        refundStatus,
      });
    }
  }

  return null;
}
