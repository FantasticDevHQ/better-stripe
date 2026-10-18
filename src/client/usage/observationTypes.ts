import type Stripe from "stripe";
import { z } from "zod";
import {
  prepareUsageRecord,
  type PreparedUsageRecord,
  type UsageScope,
} from "./records.js";
import {
  validateUsagePageRequest,
  type UsageAvailability,
  type UsagePeriod,
  type UsageSubscriptionBinding,
} from "./boundaries.js";
import { subscriptionSnapshot } from "../../component/usage/helpers.js";
import { verifyRealm, verifyMeter } from "./catalogTypes.js";
export type UsageObservationOptions = {
  scope: UsageScope;
  binding: PreparedUsageRecord["binding"];
  subscription: UsageSubscriptionBinding;
  period: UsagePeriod;
  limit?: number;
  cursor?: string | null;
};
export type UsageAggregateValue = {
  period: UsagePeriod;
  quantity: string;
  scaledQuantity: string;
  complete: boolean;
  nextCursor: string | null;
  aggregationLagPossible: true;
  stale: boolean;
  entries: Array<{
    id: string;
    start: number;
    end: number;
    scaledQuantity: string;
  }>;
};
export type UsageAggregateObservation = UsageAvailability<UsageAggregateValue>;
export function observationOptions(input: UsageObservationOptions) {
  const page = validateUsagePageRequest({
    period: input.period,
    limit: input.limit ?? 100,
    cursor: input.cursor ?? null,
  });
  const { scope, binding } = prepareUsageRecord({
    scope: input.scope,
    binding: input.binding,
    sourceEventId: "observation",
    quantity: "0",
    occurredAt: page.period.start,
  });
  const subscription = subscriptionSnapshot(JSON.stringify(input.subscription));
  if (subscription.stripePriceId !== binding.stripePriceId)
    throw new Error("Usage observation price binding mismatch");
  return {
    scope,
    binding,
    subscription,
    period: page.period,
    limit: page.limit,
    cursor: page.cursor,
  };
}
export async function verifyObservationSource(
  stripe: Stripe,
  opts: ReturnType<typeof observationOptions>,
): Promise<boolean> {
  await verifyRealm(stripe, {
    stripeAccountId: opts.scope.stripeAccountId,
    livemode: opts.scope.livemode,
  });
  const [meter, subscription] = await Promise.all([
    stripe.billing.meters.retrieve(opts.scope.meterId),
    stripe.subscriptions.retrieve(opts.subscription.subscriptionId),
  ]);
  if (
    meter.id !== opts.scope.meterId ||
    subscription.id !== opts.subscription.subscriptionId ||
    subscription.livemode !== opts.scope.livemode ||
    subscription.customer_account !== opts.scope.customerAccount ||
    (typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id) !== opts.binding.stripeCustomerId
  )
    return false;
  verifyMeter(
    meter,
    {
      scope: opts.scope,
      plan: opts.binding.plan,
      eventName: opts.binding.eventName,
      displayName: meter.display_name,
    },
    false,
  );
  return true;
}
export const observationKeyOptions = z.strictObject({
  maxAgeSeconds: z.number().int().min(1).max(86400).default(60),
});
