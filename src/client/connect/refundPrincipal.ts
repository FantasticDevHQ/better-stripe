import type Stripe from "stripe";

/** Charge.amount_refunded also includes pending refunds; only success is final. */
export async function successfulRefundPrincipal(
  stripe: Stripe,
  chargeId: string,
) {
  let principal = 0;
  let count = 0;
  for await (const refund of stripe.refunds.list({
    charge: chargeId,
    limit: 100,
  })) {
    if (++count > 1000)
      throw new Error("Successful refund lookup limit exceeded.");
    if (refund.status !== "succeeded") continue;
    if (
      !Number.isSafeInteger(refund.amount) ||
      refund.amount < 0 ||
      !Number.isSafeInteger(principal + refund.amount)
    )
      throw new Error("Invalid successful refund principal.");
    principal += refund.amount;
  }
  return principal;
}
