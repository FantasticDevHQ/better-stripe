import type { QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";

const account = (value: string) => /^acct_[A-Za-z0-9_]{1,128}$/.test(value);

/** Original persisted routing only. This is observation, never refund authorization. */
function seller(payment: Doc<"payments">): string | undefined {
  const recipients = payment.splitRecipients ?? [];
  if (payment.chargeType !== "separate") {
    if (recipients.length || !payment.destinationAccountId) return undefined;
    return account(payment.destinationAccountId)
      ? payment.destinationAccountId
      : undefined;
  }
  if (payment.destinationAccountId !== undefined) return undefined;
  const destinations = new Set<string>();
  let store: string | undefined;
  for (const recipient of recipients) {
    if (
      !account(recipient.destinationAccountId) ||
      destinations.has(recipient.destinationAccountId)
    )
      return undefined;
    destinations.add(recipient.destinationAccountId);
    if (recipient.role === "store") {
      if (store !== undefined) return undefined;
      store = recipient.destinationAccountId;
    }
  }
  return store;
}

/** At most two original PI rows; duplicate routing is not resolved by selecting a current owner. */
export async function originalRefundSeller(
  ctx: QueryCtx,
  stripePaymentIntentId: string,
  currency: string,
): Promise<string | undefined> {
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_stripe_payment_intent_id", (q) =>
      q.eq("stripePaymentIntentId", stripePaymentIntentId),
    )
    .take(2);
  const payment = payments[0];
  if (payments.length !== 1 || !payment || payment.currency !== currency)
    return undefined;
  return seller(payment);
}
