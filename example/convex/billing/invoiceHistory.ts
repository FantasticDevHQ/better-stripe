import type {
  InvoicePageOptions,
  ProviderInvoicePage,
} from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server";
import { stripe } from "../stripe/helpers";

/** Server-only reference: authorize the buyer before calling; demo personas are not sessions. */
export async function readBuyerInvoicePage(
  ctx: ActionCtx,
  buyerUserId: string,
  options: Omit<InvoicePageOptions, "customerAccount">,
): Promise<ProviderInvoicePage> {
  if (!buyerUserId.trim()) throw new Error("Buyer account unavailable");
  const account = await stripe.getAccountByUserId(ctx, { userId: buyerUserId });
  if (!account || account.userId !== buyerUserId || account.orgId)
    throw new Error("Buyer account unavailable");
  return stripe.getInvoicePageFromStripe(ctx, {
    ...options,
    customerAccount: account.stripeAccountId,
  });
}
