import type Stripe from "stripe";

/** Locate the exact receipt, never infer operation success from an aggregate. */
export async function findCommissionReversal(
  stripe: Stripe,
  stripeTransferId: string,
  operationId: string,
  amount: number,
) {
  let count = 0;
  for await (const receipt of stripe.transfers.listReversals(stripeTransferId, {
    limit: 100,
  })) {
    if (++count > 1000)
      throw new Error("Commission reversal receipt lookup limit exceeded.");
    if (receipt.metadata?.bsReversalOperation === operationId) {
      if (receipt.amount !== amount)
        throw new Error("Commission reversal receipt amount mismatch.");
      return receipt;
    }
  }
  return null;
}
