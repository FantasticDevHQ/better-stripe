import { convexToJson } from "convex/values";
import type { QueryCtx } from "../_generated/server.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
import type { UsageSubscriptionBinding } from "../../client/usage/boundaries.js";
import type { UsageSubscriptionView } from "../../client/usage/subscriptionTerms.js";
/** Managed v1 closes new acceptance/sends 60 seconds before the native period. */
export async function managedBillingCutoff(
  ctx: QueryCtx,
  record: PreparedUsageRecord,
  subscription: UsageSubscriptionBinding,
): Promise<number | null> {
  const candidates = await ctx.db
    .query("usageSubscriptionIntents")
    .withIndex("by_provider", (q) =>
      q.eq("providerId", subscription.subscriptionId),
    )
    .take(3);
  const matched = candidates.filter((intent) => {
    const scope = JSON.parse(intent.scopeKey);
    return (
      scope.stripeAccountId === record.scope.stripeAccountId &&
      scope.livemode === record.scope.livemode &&
      scope.customerAccount === record.scope.customerAccount
    );
  });
  if (!matched.length) return candidates.length >= 3 ? 0 : null;
  if (
    matched.length !== 1 ||
    !matched[0].viewJson ||
    matched[0].retiredAt !== undefined
  )
    return 0;
  const view = JSON.parse(matched[0].viewJson) as UsageSubscriptionView;
  const original = view.bindings.find(
    (item) =>
      item.scope.meterId === record.scope.meterId &&
      item.subscription.subscriptionItemId === subscription.subscriptionItemId,
  );
  if (
    !original ||
    view.status !== "active" ||
    JSON.stringify(convexToJson(original.scope)) !==
      JSON.stringify(convexToJson(record.scope)) ||
    JSON.stringify(convexToJson(original.binding)) !==
      JSON.stringify(convexToJson(record.binding)) ||
    JSON.stringify(convexToJson(original.subscription)) !==
      JSON.stringify(convexToJson(subscription))
  )
    return 0;
  return subscription.period.end - 60;
}
