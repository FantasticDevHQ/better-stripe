import type {
  InvoicePaymentPageOptions,
  ProviderInvoicePaymentPage,
} from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server";
import { stripe } from "../stripe/helpers";

/** Server-only reference: authorize the buyer first; demo personas are not sessions. */
export async function readBuyerInvoicePaymentPage(
  ctx: ActionCtx,
  buyerUserId: string,
  options: Omit<InvoicePaymentPageOptions, "customerAccount">,
): Promise<ProviderInvoicePaymentPage> {
  if (!buyerUserId.trim()) throw new Error("Buyer account unavailable");
  const account = await stripe.getAccountByUserId(ctx, { userId: buyerUserId });
  if (!account || account.userId !== buyerUserId || account.orgId)
    throw new Error("Buyer account unavailable");
  return stripe.getInvoicePaymentPageFromStripe(ctx, {
    ...options,
    customerAccount: account.stripeAccountId,
  });
}
