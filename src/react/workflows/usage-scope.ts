import type { UsageBillingSnapshot, UsageViewScope } from "./Usage.types.js";
import type { UsageLocalSummary } from "../../client/usage/summary.js";
export function usageSummaryMatches(
  scope: UsageViewScope,
  value: UsageLocalSummary,
) {
  return (
    value.period.start === scope.period.start &&
    value.period.end === scope.period.end &&
    value.groups.every(
      (group) =>
        group.binding.plan.rate.currency.toLowerCase() ===
          scope.currency.toLowerCase() &&
        (group.estimate.status !== "available" ||
          group.estimate.value.currency.toLowerCase() ===
            scope.currency.toLowerCase()),
    )
  );
}
export function usageSnapshotMatches(
  scope: UsageViewScope,
  value: UsageBillingSnapshot,
) {
  const periodMatches = (period: { start: number; end: number }) =>
    period.start === scope.period.start && period.end === scope.period.end;
  const currencyMatches = (currency: string) =>
    currency.toLowerCase() === scope.currency.toLowerCase();
  return (
    (value.summary.status !== "available" ||
      usageSummaryMatches(scope, value.summary.value)) &&
    (value.provider?.status !== "available" ||
      periodMatches(value.provider.value.period)) &&
    (value.allowance?.status !== "available" ||
      !value.allowance.value ||
      (periodMatches(value.allowance.value.period) &&
        currencyMatches(value.allowance.value.committedEstimate.currency) &&
        currencyMatches(value.allowance.value.projectedEstimate.currency))) &&
    (value.credits?.status !== "available" ||
      currencyMatches(value.credits.value.currency)) &&
    (!value.purchase || currencyMatches(value.purchase.currency))
  );
}
