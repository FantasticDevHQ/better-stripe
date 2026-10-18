import { convexToJson } from "convex/values";
import type { PreparedUsageRecord, UsageDeliveryState } from "./records.js";
import { parseUsageQuantity } from "./contracts.js";
import type {
  UsageAvailability,
  UsagePeriod,
  UsageSubscriptionBinding,
} from "./boundaries.js";
export type UsageSummaryEvent = {
  record: PreparedUsageRecord;
  subscription: UsageSubscriptionBinding;
  delivery: UsageDeliveryState;
  hasValidationError: boolean;
};
export type UsageCreditSummary = {
  availableQuantity: string;
  reservedQuantity: string;
  consumedQuantity: string;
  expiredQuantity: string;
};
export type UsageLocalGroup = {
  binding: PreparedUsageRecord["binding"];
  subscription: UsageSubscriptionBinding;
  acceptedScaledQuantity: string;
  providerAcceptedScaledQuantity: string;
  acceptedQuantity: string;
  providerAcceptedQuantity: string;
  eventCount: number;
  validationErrorEventCount: number;
  deliveryQuantities: Record<UsageDeliveryState, string>;
  estimate: UsageAvailability<{ amountDecimal: string; currency: string }>;
  included: UsageAvailability<{
    included: string;
    consumed: string;
    remaining: string;
    overage: string;
  }>;
  credits: UsageAvailability<UsageCreditSummary>;
};
export type UsageLocalSummary = {
  period: UsagePeriod;
  observedAt: number;
  complete: boolean;
  eventCount: number;
  groups: UsageLocalGroup[];
};
export function decimalFromScaled(value: bigint, precision: number): string {
  if (precision === 0) return value.toString();
  const digits = value.toString().padStart(precision + 1, "0"),
    whole = digits.slice(0, -precision),
    fraction = digits.slice(-precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
function rateAmount(quantity: bigint, record: PreparedUsageRecord) {
  const [whole, fraction = ""] =
    record.binding.plan.rate.unitAmountDecimal.split(".");
  return decimalFromScaled(
    quantity * BigInt(whole + fraction),
    record.binding.plan.unit.precision + fraction.length,
  );
}
const unavailable = (reason: string) => ({
  status: "unavailable" as const,
  reason,
  retryable: false,
});
const states: UsageDeliveryState[] = [
  "queued",
  "sending",
  "provider_accepted",
  "rejected",
  "unknown",
  "held",
];
export function summarizeUsageRecords(
  events: UsageSummaryEvent[],
  options: { period: UsagePeriod; complete: boolean; observedAt: number },
): UsageLocalSummary {
  const grouped = new Map<string, UsageSummaryEvent[]>();
  for (const event of events) {
    const key = JSON.stringify(
      convexToJson([event.record.binding, event.subscription]),
    );
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  const groups: UsageLocalGroup[] = [];
  for (const values of grouped.values()) {
    const { record, subscription } = values[0],
      plan = record.binding.plan,
      precision = plan.unit.precision;
    const sums = Object.fromEntries(
      states.map((state) => [state, 0n]),
    ) as Record<UsageDeliveryState, bigint>;
    for (const value of values)
      sums[value.delivery] += BigInt(value.record.scaledQuantity);
    const accepted = states.reduce((sum, state) => sum + sums[state], 0n);
    const fullPeriod =
      options.period.start === subscription.period.start &&
      options.period.end === subscription.period.end;
    const eligible =
      options.complete && (plan.model !== "included_overage" || fullPeriod);
    let chargeable = accepted;
    let included: UsageLocalGroup["included"] = unavailable(
      plan.model === "included_overage"
        ? options.complete
          ? "partial_billing_period"
          : "local_history_incomplete"
        : "not_included_model",
    );
    if (plan.model === "included_overage" && eligible) {
      const allowance = BigInt(
        parseUsageQuantity(plan.includedQuantity, precision).scaledQuantity,
      );
      chargeable = accepted > allowance ? accepted - allowance : 0n;
      included = {
        status: "available",
        observedAt: options.observedAt,
        value: {
          included: decimalFromScaled(allowance, precision),
          consumed: decimalFromScaled(accepted, precision),
          remaining: decimalFromScaled(
            allowance > accepted ? allowance - accepted : 0n,
            precision,
          ),
          overage: decimalFromScaled(chargeable, precision),
        },
      };
    }
    groups.push({
      binding: record.binding,
      subscription,
      acceptedScaledQuantity: accepted.toString(),
      providerAcceptedScaledQuantity: sums.provider_accepted.toString(),
      acceptedQuantity: decimalFromScaled(accepted, precision),
      providerAcceptedQuantity: decimalFromScaled(
        sums.provider_accepted,
        precision,
      ),
      eventCount: values.length,
      validationErrorEventCount: values.filter((v) => v.hasValidationError)
        .length,
      deliveryQuantities: Object.fromEntries(
        states.map((state) => [
          state,
          decimalFromScaled(sums[state], precision),
        ]),
      ) as Record<UsageDeliveryState, string>,
      included,
      estimate: !options.complete
        ? unavailable("local_history_incomplete")
        : plan.model === "prepaid"
          ? unavailable("credit_accounting_not_configured")
          : !eligible
            ? unavailable("partial_billing_period")
            : {
                status: "available",
                observedAt: options.observedAt,
                value: {
                  amountDecimal: rateAmount(chargeable, record),
                  currency: plan.rate.currency,
                },
              },
      credits: unavailable(
        plan.model === "prepaid"
          ? "credit_accounting_not_configured"
          : "not_prepaid_model",
      ),
    });
  }
  for (const group of groups) {
    if (
      groups.some(
        (other) =>
          other !== group &&
          other.binding.stripeCustomerId === group.binding.stripeCustomerId &&
          other.subscription.period.start < group.subscription.period.end &&
          other.subscription.period.end > group.subscription.period.start,
      )
    ) {
      group.estimate = unavailable("ambiguous_subscription_binding");
      if (group.binding.plan.model === "included_overage")
        group.included = unavailable("ambiguous_subscription_binding");
    }
  }
  return { ...options, eventCount: events.length, groups };
}
