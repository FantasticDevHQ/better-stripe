import { convexToJson } from "convex/values";
import type { UsageLocalSummary } from "./summary.js";
import { decimalFromScaled } from "./summary.js";
import type { UsageAggregateObservation } from "./observationTypes.js";
import type { PreparedUsageRecord } from "./records.js";
export type UsageComparison = {
  status: "observed_match" | "mismatch" | "unavailable";
  reason: string;
  localAcceptedQuantity: string | null;
  providerAcceptedQuantity: string | null;
  providerAggregateQuantity: string | null;
};
export function compareUsageObservations(
  local: UsageLocalSummary,
  aggregate: UsageAggregateObservation,
  binding: PreparedUsageRecord["binding"],
): UsageComparison {
  const value: UsageComparison = {
    status: "unavailable",
    reason: "provider_unavailable",
    localAcceptedQuantity: null,
    providerAcceptedQuantity: null,
    providerAggregateQuantity:
      aggregate.status === "available" ? aggregate.value.quantity : null,
  };
  const unavailable = (reason: string) => ({ ...value, reason });
  if (!local.complete) return unavailable("local_history_incomplete");
  if (
    local.groups.some(
      (group) =>
        JSON.stringify(convexToJson(group.binding)) !==
        JSON.stringify(convexToJson(binding)),
    )
  )
    return unavailable("ambiguous_local_terms");
  const accepted = local.groups.reduce(
      (sum, group) => sum + BigInt(group.acceptedScaledQuantity),
      0n,
    ),
    provider = local.groups.reduce(
      (sum, group) => sum + BigInt(group.providerAcceptedScaledQuantity),
      0n,
    );
  value.localAcceptedQuantity = decimalFromScaled(
    accepted,
    binding.plan.unit.precision,
  );
  value.providerAcceptedQuantity = decimalFromScaled(
    provider,
    binding.plan.unit.precision,
  );
  if (aggregate.status !== "available") return unavailable(aggregate.reason);
  if (aggregate.value.stale) return unavailable("aggregate_stale");
  if (!aggregate.value.complete)
    return unavailable("provider_history_incomplete");
  if (
    local.period.start !== aggregate.value.period.start ||
    local.period.end !== aggregate.value.period.end
  )
    return unavailable("period_mismatch");
  if (
    local.groups.some(
      (g) =>
        g.deliveryQuantities.unknown !== "0" ||
        g.deliveryQuantities.sending !== "0",
    )
  )
    return unavailable("delivery_unresolved");
  if (local.groups.some((g) => g.validationErrorEventCount > 0))
    return {
      ...value,
      status: "mismatch",
      reason: "provider_validation_errors",
    };
  return {
    ...value,
    status:
      provider === BigInt(aggregate.value.scaledQuantity)
        ? "observed_match"
        : "mismatch",
    reason:
      provider === BigInt(aggregate.value.scaledQuantity)
        ? "observations_equal"
        : "aggregation_lag_or_external_usage",
  };
}
