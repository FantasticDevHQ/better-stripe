import { convexToJson } from "convex/values";
import type { QueryCtx } from "../_generated/server.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
import type { UsageSubscriptionBinding } from "../../client/usage/boundaries.js";
import type { UsageSubscriptionView } from "../../client/usage/subscriptionTerms.js";
/** Managed v1 closes new acceptance/sends 60 seconds before the native period. */
export async function managedBillingPolicy(
  ctx: QueryCtx,
  record: PreparedUsageRecord,
  subscription: UsageSubscriptionBinding,
): Promise<{
  cutoff: number;
  collection: UsageSubscriptionView["collection"] | null;
} | null> {
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
  if (!matched.length)
    return candidates.length >= 3 ? { cutoff: 0, collection: null } : null;
  if (
    matched.length !== 1 ||
    !matched[0].viewJson ||
    matched[0].retiredAt !== undefined
  )
    return { cutoff: 0, collection: null };
  const view = JSON.parse(matched[0].viewJson) as UsageSubscriptionView;
  const original = view.bindings.find(
    (item) =>
      item.scope.meterId === record.scope.meterId &&
      item.subscription.subscriptionItemId === subscription.subscriptionItemId,
  );
  if (
    !view.collection ||
    !original ||
    view.status !== "active" ||
    JSON.stringify(convexToJson(original.scope)) !==
      JSON.stringify(convexToJson(record.scope)) ||
    JSON.stringify(convexToJson(original.binding)) !==
      JSON.stringify(convexToJson(record.binding)) ||
    JSON.stringify(convexToJson(original.subscription)) !==
      JSON.stringify(convexToJson(subscription))
  )
    return { cutoff: 0, collection: null };
  return { cutoff: subscription.period.end - 60, collection: view.collection };
}

export async function managedBillingCutoff(
  ctx: QueryCtx,
  record: PreparedUsageRecord,
  subscription: UsageSubscriptionBinding,
): Promise<number | null> {
  return (
    (await managedBillingPolicy(ctx, record, subscription))?.cutoff ?? null
  );
}
