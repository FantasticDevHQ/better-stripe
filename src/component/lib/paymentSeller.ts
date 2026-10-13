import type { MutationCtx } from "../_generated/server";

export async function paymentSeller(
  ctx: MutationCtx,
  stripePaymentIntentId?: string,
): Promise<string | undefined> {
  if (!stripePaymentIntentId) return undefined;
  const payment = await ctx.db
    .query("payments")
    .withIndex("by_stripe_payment_intent_id", (q) =>
      q.eq("stripePaymentIntentId", stripePaymentIntentId),
    )
    .first();
  return payment?.destinationAccountId;
}
