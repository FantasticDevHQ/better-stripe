import type { Infer } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import { originalRefundSeller } from "../refundHistory/originalSeller.js";
import { refundById } from "./helpers.js";
import type { routingInput, routingResult } from "./validators.js";

/** Unknown attribution cannot silently inherit a mutable payment's current destination. */
export async function refundRouting(
  ctx: QueryCtx | MutationCtx,
  input: { [K in keyof typeof routingInput]: Infer<(typeof routingInput)[K]> },
): Promise<Infer<typeof routingResult>> {
  const existing = await refundById(ctx, input.stripeRefundId);
  const allocations = await ctx.db
    .query("settlementAllocations")
    .withIndex("by_source_charge", (q) =>
      q.eq("sourceChargeId", input.stripeChargeId),
    )
    .take(2);
  const merchant = await originalRefundSeller(ctx, input);
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_stripe_payment_intent_id", (q) =>
      q.eq("stripePaymentIntentId", input.stripePaymentIntentId),
    )
    .take(2);
  if (
    payments.length > 1 ||
    (payments[0] !== undefined && payments[0].currency !== input.currency) ||
    (allocations.length > 0 && !merchant) ||
    (existing?.accountId !== undefined &&
      !/^acct_[A-Za-z0-9_]{1,250}$/.test(existing.accountId)) ||
    (merchant &&
      existing?.accountId !== undefined &&
      merchant !== existing.accountId)
  )
    return {
      status: "held",
      merchantAccount: null,
      requiresChargeProof: false,
    };
  if (merchant)
    return {
      status: "known",
      merchantAccount: merchant,
      requiresChargeProof: false,
    };
  const payment = payments[0];
  const fallback = payment?.destinationAccountId;
  return {
    status: "unknown",
    merchantAccount: null,
    requiresChargeProof:
      existing?.accountId !== undefined || fallback !== undefined,
  };
}
