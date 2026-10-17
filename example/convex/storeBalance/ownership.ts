import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { internal } from "../_generated/api";
import { assertTestModeStripeKey } from "../users/authorization";
import { balanceStripe } from "./stripe";
export async function ownedBillingSubscription(
  ctx: ActionCtx,
  sellerId: Id<"users">,
) {
  assertTestModeStripeKey(env.STRIPE_SECRET_KEY);
  const seller = await ctx.runQuery(
    internal.storePlans.billing.internal.queries.getSeller,
    { sellerId },
  );
  if (!seller.stripeAccountId || !seller.storePlan)
    throw new Error("Activate a store plan first.");
  const sub = await balanceStripe.getSubscriptionFromStripe(ctx, {
    stripeSubscriptionId: seller.storePlan.stripeSubscriptionId,
  });
  if (
    sub.id !== seller.storePlan.stripeSubscriptionId ||
    sub.customer_account !== seller.stripeAccountId ||
    sub.metadata.storeBilling !== "plan_v1" ||
    sub.metadata.sellerId !== seller.sellerId
  )
    throw new Error("Subscription does not belong to this store.");
  return { seller, sub };
}
