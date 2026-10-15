import { recoverSettlementTransfers } from "../settlement/reconciliation.js";
import { componentRef } from "./helpers.js";
import type Stripe from "stripe";
import type { WebhookContext } from "./helpers.js";
import {
  reinstateTransfers,
  reverseTransfersForDispute,
} from "../connect/transfers.js";
import { successfulRefundPrincipal } from "../connect/refundPrincipal.js";
export async function reconcileDisputeMoney(
  whCtx: WebhookContext,
  dispute: Stripe.Dispute,
  event: string,
  originalCharge?: Stripe.Charge,
) {
  if (dispute.status.startsWith("warning_") || dispute.status === "prevented")
    return;
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (
    !chargeId ||
    !["created", "funds_withdrawn", "closed", "funds_reinstated"].includes(
      event,
    )
  )
    return;
  await recoverSettlementTransfers(
    whCtx.stripe,
    whCtx.component,
    whCtx.ctx,
    chargeId,
  );
  const legs = await whCtx.ctx.runQuery(
    componentRef(whCtx.component, "connect/queries/listTransfersByCharge"),
    { sourceChargeId: chargeId },
  );
  const obligations = await whCtx.ctx.runQuery(
    componentRef(
      whCtx.component,
      "affiliateRecovery/queries/chargeObligations",
    ),
    { sourceChargeId: chargeId },
  );
  if (
    (!Array.isArray(legs) || !legs.length) &&
    (!Array.isArray(obligations) || !obligations.length)
  )
    return;
  const won = event === "funds_reinstated" || dispute.status === "won";
  const charge =
    originalCharge ?? (await whCtx.stripe.charges.retrieve(chargeId));
  const refundedPrincipal = await successfulRefundPrincipal(
    whCtx.stripe,
    chargeId,
  );
  await reverseTransfersForDispute(whCtx.stripe, whCtx.component, whCtx.ctx, {
    sourceChargeId: chargeId,
    operationId: dispute.id,
    chargeAmount: charge.amount,
    amount: dispute.amount,
    finalized: dispute.status === "lost",
    disputeState: won ? "won" : dispute.status === "lost" ? "lost" : "open",
    refundedPrincipal,
  });
  if (won)
    await reinstateTransfers(whCtx.stripe, whCtx.component, whCtx.ctx, {
      sourceChargeId: chargeId,
      operationId: dispute.id,
      currency: dispute.currency,
      excludeAffiliates: true,
      chargeAmount: charge.amount,
      refundedPrincipal,
    });
}
