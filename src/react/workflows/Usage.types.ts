import type { UsageViewScope } from "../../client/usage/views.js";
export type {
  UsageViewScope,
  UsageBillingSnapshot,
} from "../../client/usage/views.js";
export function usageViewKey(scope: UsageViewScope) {
  return JSON.stringify([
    scope.identityKey,
    scope.accountKey,
    scope.meterKey,
    scope.period.start,
    scope.period.end,
    scope.currency.toLowerCase(),
  ]);
}
