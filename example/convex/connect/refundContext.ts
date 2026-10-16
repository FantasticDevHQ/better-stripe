import type {
  RefundContext,
  RefundContextOptions,
} from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server";
import { stripe } from "../stripe/helpers";
import { assertPaymentOwner } from "../users/authorization";

/** Server-only platform-charge reference; the host must authenticate this demo persona first. */
export async function readSellerRefundContext(
  ctx: ActionCtx,
  sellerUserId: string,
  options: Pick<
    RefundContextOptions,
    "stripePaymentIntentId" | "maxRefundPages"
  >,
): Promise<RefundContext> {
  const account = await assertPaymentOwner(ctx, {
    userId: sellerUserId,
    stripePaymentIntentId: options.stripePaymentIntentId,
  });
  if (account.userId !== sellerUserId || account.orgId)
    throw new Error("Seller account unavailable");
  return stripe.getRefundContext(ctx, {
    stripePaymentIntentId: options.stripePaymentIntentId,
    ...(options.maxRefundPages === undefined
      ? {}
      : { maxRefundPages: options.maxRefundPages }),
    actor: { type: "seller", accountId: account.stripeAccountId },
  });
}
