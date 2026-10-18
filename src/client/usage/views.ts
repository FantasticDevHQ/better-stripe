import type { UsageAvailability, UsagePeriod } from "./boundaries.js";
import type { UsageLocalSummary } from "./summary.js";
import type { UsageAggregateObservation } from "./observationTypes.js";
import type { UsageAllowanceStatus } from "./allowanceTerms.js";
import type { UsageCreditBalance, UsageCreditPurchase } from "./creditTerms.js";
import type { UsageCreditReconciliation } from "./creditObservation.js";
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
