import {
  defineUsagePlan,
  type UsageBillingModel,
} from "../../client/usage/contracts.js";
import { prepareUsageRecord } from "../../client/usage/records.js";
import { summarizeUsageRecords } from "../../client/usage/summary.js";
import type { UsageViewScope, UsageBillingSnapshot } from "./Usage.types.js";
export const usageScope: UsageViewScope = {
  identityKey: "actor1",
  accountKey: "tenant1",
  meterKey: "calls-v1",
  period: { start: 600, end: 1200 },
  currency: "usd",
};
export function usageSnapshot(
  quantity = "14",
  model: UsageBillingModel = "pay_as_you_go",
): UsageBillingSnapshot {
  const record = prepareUsageRecord({
    scope: {
      stripeAccountId: "acct_platform",
      customerAccount: "acct_buyer",
      meterId: "mtr_calls",
      livemode: false,
    },
    binding: {
      stripeCustomerId: "cus_buyer",
      stripePriceId: "price_calls",
      eventName: "calls",
      plan: defineUsagePlan({
        key: "calls",
        version: "v1",
        model,
        ...(model === "included_overage"
          ? { includedQuantity: "10", reset: "billing_period" }
          : model === "prepaid"
            ? { insufficientBalance: "reject" }
            : {}),
        unit: { name: "call", precision: 6 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
      }),
    },
    sourceEventId: "work1",
    quantity,
    occurredAt: 700,
  });
  const subscription = {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period: usageScope.period,
    interval: "month" as const,
  };
  return {
    summary: {
      status: "available",
      observedAt: 700,
      value: summarizeUsageRecords(
        [
          {
            record,
            subscription,
            delivery: "unknown",
            hasValidationError: false,
          },
        ],
        { period: usageScope.period, complete: true, observedAt: 700 },
      ),
    },
    provider: {
      status: "unavailable",
      reason: "provider_not_observed",
      retryable: true,
    },
  };
}
export const creditBalance = {
  availableQuantity: "0",
  reservedQuantity: "2",
  consumedQuantity: "8",
  expiredQuantity: "0",
  frozenQuantity: "0",
  precision: 0,
  currency: "usd",
  unit: "call",
  status: "available" as const,
  cashCollection: "none" as const,
};
