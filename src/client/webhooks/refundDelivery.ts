import type Stripe from "stripe";
import { prepareRefundSync } from "../connect/refundSync.js";
import { componentRef, type WebhookContext } from "./helpers.js";
import { dispatchRefundReconciliation } from "./refundReconciliation.js";
import type { RefundReconciliationResult } from "./refundReconciliationValidators.js";
import { recoverRefundTransfers } from "./refundRecovery.js";

/** A signed notification selects the refund ID/API realm, never its current state. */
export async function handleRefundEvent(
  whCtx: WebhookContext,
  notification: Stripe.Refund,
  accountId?: string,
) {
  const prepared = await prepareRefundSync(
    whCtx.stripe, whCtx.component, whCtx.ctx,
    {
      stripeRefundId: notification.id,
      scope: accountId === undefined
        ? { type: "platform" }
        : { type: "connected", accountId },
    },
  );
  let accepted: RefundReconciliationResult;
  try {
    accepted = await dispatchRefundReconciliation(whCtx, prepared);
  } catch (error) {
    await whCtx.ctx.runMutation(
      componentRef(whCtx.component, "refundSync/mutations/markUnknown"),
      {
        stripeRefundId: prepared.stripeRefundId,
        apiContext: prepared.apiContext,
        generation: prepared.generation,
      },
    );
    throw error;
  }
  // Mirror replay does not prove a previously interrupted recovery completed.
  await recoverRefundTransfers(whCtx, accepted.refund, accepted.apiContext);
}
