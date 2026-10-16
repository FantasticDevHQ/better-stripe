import type {
  RefundCommandEvidence,
  RefundCommandEvidenceOptions,
} from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server.js";
import { stripe } from "../stripe/helpers.js";
import { requireOriginalPersonalAccount } from "../billing/personalAccountMapping.js";

/** Server-owned immutable command only; the host authenticates this example's demo persona first. */
export async function readSellerRefundCommandEvidence(
  ctx: ActionCtx,
  sellerUserId: string,
  originalCommand: RefundCommandEvidenceOptions,
): Promise<RefundCommandEvidence> {
  await requireOriginalPersonalAccount(
    ctx,
    sellerUserId,
    originalCommand.stripeAccountId,
  );
  return stripe.getRefundCommandEvidence(ctx, {
    commandKey: originalCommand.commandKey,
    stripeAccountId: originalCommand.stripeAccountId,
    stripePaymentIntentId: originalCommand.stripePaymentIntentId,
    stripeChargeId: originalCommand.stripeChargeId,
    currency: originalCommand.currency,
  });
}
