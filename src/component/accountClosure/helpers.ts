import type { MutationCtx, QueryCtx } from "../_generated/server.js";
export function closureByStripeId(ctx: QueryCtx, stripeAccountId: string) {
  return ctx.db
    .query("accountClosures")
    .withIndex("by_stripe_account_id", (q) =>
      q.eq("stripeAccountId", stripeAccountId),
    )
    .unique();
}
/** A delayed account event cannot revive a closed recipient or change a pinned owner. */
export async function canUpsertAccount(
  ctx: MutationCtx,
  account: { stripeAccountId: string; userId: string; orgId?: string },
) {
  const closure = await closureByStripeId(ctx, account.stripeAccountId);
  if (!closure) return true;
  if (closure.state === "closed") return false;
  if (closure.userId !== account.userId || closure.orgId !== account.orgId)
    throw new Error("Account ownership is pinned while closure is unresolved");
  return true;
}
