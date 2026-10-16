import type {
  CheckoutSessionPageOptions,
  ProviderCheckoutSessionPage,
} from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server";
import { stripe } from "../stripe/helpers";

/** Server-only reference. Derive buyerUserId from host auth, never a browser persona. */
export async function readBuyerCheckoutSessionPage(
  ctx: ActionCtx,
  buyerUserId: string,
  options: Omit<CheckoutSessionPageOptions, "customerAccount">,
): Promise<ProviderCheckoutSessionPage> {
  if (!buyerUserId.trim()) throw new Error("Buyer account unavailable");
  const account = await stripe.getAccountByUserId(ctx, { userId: buyerUserId });
  if (!account || account.userId !== buyerUserId || account.orgId)
    throw new Error("Buyer account unavailable");
  return stripe.getCheckoutSessionPageFromStripe(ctx, {
    ...options,
    customerAccount: account.stripeAccountId,
  });
}
