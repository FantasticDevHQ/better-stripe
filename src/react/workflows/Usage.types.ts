import type {
  UsageAvailability,
  UsagePeriod,
} from "../../client/usage/boundaries.js";
import type { UsageLocalSummary } from "../../client/usage/summary.js";
import type { UsageAggregateObservation } from "../../client/usage/observationTypes.js";
import type { UsageAllowanceStatus } from "../../client/usage/allowanceTerms.js";
import type {
  UsageCreditBalance,
  UsageCreditPurchase,
} from "../../client/usage/creditTerms.js";
import type { UsageCreditReconciliation } from "../../client/usage/creditObservation.js";
/** Cache identity only. The authenticated host must resolve and authorize original native bindings. */
export type UsageViewScope = {
  identityKey: string;
  accountKey: string;
  /** Include original plan/price version in this opaque host meter key. */
  meterKey: string;
  period: UsagePeriod;
  currency: string;
};
export type UsageBillingSnapshot = {
  summary: UsageAvailability<UsageLocalSummary>;
  provider?: UsageAggregateObservation;
  allowance?: UsageAvailability<UsageAllowanceStatus | null>;
  credits?: UsageAvailability<UsageCreditBalance>;
  purchase?: UsageCreditPurchase | null;
  creditApplication?: UsageAvailability<UsageCreditReconciliation>;
};
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
