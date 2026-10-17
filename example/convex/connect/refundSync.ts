import type {
  RefundSyncOptions,
  RefundSyncResult,
} from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server.js";
import { stripe } from "../stripe/helpers.js";

/** Server-only reference: authenticate/authorize the original refund and API namespace first. */
export async function reconcileAuthorizedRefund(
  ctx: ActionCtx,
  originalScope: RefundSyncOptions,
): Promise<RefundSyncResult> {
  return stripe.syncRefundFromStripe(ctx, originalScope);
}
