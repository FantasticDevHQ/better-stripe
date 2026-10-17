import type { QueryCtx } from "../../_generated/server.js";
import { stripe } from "../../stripe/helpers.js";
import { historyActor } from "./actor.js";

/** Server-only adapter: original IDs must come from the host's immutable purchase record. */
export async function requireOriginalSubscription(
  ctx: QueryCtx,
  original: { stripeAccountId: string; stripeSubscriptionId: string },
) {
  const actor = await historyActor(ctx);
  const account = await stripe.getAccountByStripeId(ctx, {
    stripeAccountId: original.stripeAccountId,
    requireUnique: true,
  });
  const subscription = await stripe.getSubscriptionByStripeId(ctx, {
    stripeSubscriptionId: original.stripeSubscriptionId,
    requireUnique: true,
  });
  if (
    !account ||
    !subscription ||
    account.userId !== actor._id ||
    account.orgId !== undefined ||
    subscription.userId !== actor._id ||
    subscription.orgId !== undefined ||
    subscription.accountId !== original.stripeAccountId
  )
    throw new Error("Original subscription unavailable");
  return { account, subscription };
}
