import { successfulRefundPrincipal } from "../connect/refundPrincipal.js";
import { reverseTransfersForRefund } from "../connect/transfers.js";
import type { StripeComponentRefund } from "../types.js";
import { componentRef, type WebhookContext } from "./helpers.js";

/** Existing split recovery, selected only by an accepted current observation. */
export async function recoverRefundTransfers(
  whCtx: WebhookContext,
  refund: StripeComponentRefund,
  apiContext: string,
) {
  // Split-sale clawback (BTS-34): when a separate-charges sale is refunded,
  // pull the refunded share back from each recipient pro-rata. Only ledger
  // legs identify a split sale — destination-charge auto-transfers are not in
  // the ledger and are handled by Stripe-native `reverse_transfer` at refund
  // creation. Runs on `refund.updated` too so a pending→succeeded refund
  // (e.g. ACH) still claws back. Errors propagate → event `failed` → Stripe
  // retries; `reverseTransfersForRefund`'s delta-to-target math makes the
  // re-run converge without double-reversing.
  const chargeId = refund.stripeChargeId;
  if (refund.status !== "succeeded" || !chargeId) return;
  const legs = ((await whCtx.ctx.runQuery(
    componentRef(whCtx.component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: chargeId },
  )) ?? []) as unknown[];
  if (legs.length === 0) {
    const obligations = (await whCtx.ctx.runQuery(
      componentRef(
        whCtx.component,
        "affiliateRecovery/queries/chargeObligations",
      ),
      { sourceChargeId: chargeId },
    )) as unknown[] | null;
    if (!obligations?.length) return;
  }

  // The existing split recovery engine operates in the platform namespace.
  // A signed connected read cannot authorize unscoped platform money operations.
  if (apiContext !== "platform")
    throw new Error("Connected refund split recovery requires qualified platform authority.");

  // Fetch succeeded refunds: charge.amount_refunded can include pending funds.
  const charge = await whCtx.stripe.charges.retrieve(chargeId);
  await reverseTransfersForRefund(whCtx.stripe, whCtx.component, whCtx.ctx, {
    sourceChargeId: chargeId,
    refundId: refund.stripeRefundId,
    chargeAmount: charge.amount,
    amountRefunded: await successfulRefundPrincipal(whCtx.stripe, chargeId),
  });
}
