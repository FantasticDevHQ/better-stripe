import type { StripeComponentAccount } from "@fantastic.dev/better-stripe";
import type { ActionCtx } from "../_generated/server.js";
import { stripe } from "../stripe/helpers.js";

/** Authenticate an enabled host actor first; the original account comes from verified payment routing. */
export async function requireOriginalPersonalAccount(
  ctx: ActionCtx,
  authenticatedUserId: string,
  originalStripeAccountId: string,
): Promise<StripeComponentAccount> {
  const result = await stripe.getPersonalAccountMapping(ctx, {
    userId: authenticatedUserId,
  });
  if (
    result.status !== "unique" ||
    result.account.userId !== authenticatedUserId ||
    result.account.orgId !== undefined ||
    result.account.stripeAccountId !== originalStripeAccountId
  )
    throw new Error("Original personal account unavailable");
  return result.account;
}
