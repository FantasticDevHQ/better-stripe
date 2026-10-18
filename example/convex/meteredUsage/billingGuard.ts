import type {
  UsageLocalSummary,
  UsageComparison,
} from "@fantastic.dev/better-stripe/usage";
type Correction = { key: string; sequence: number; state: string };
/** Test-clock advancement is a fixture operation, never proof that Stripe ingested usage. */
export function assertDemoBillingReady(input: {
  local: UsageLocalSummary;
  comparison: UsageComparison;
  reservedQuantity: string;
  corrections: {
    isDone: boolean;
    legacyHistoryMissing: boolean;
    records: readonly Correction[];
  };
}): void {
  if (!input.local.complete || input.comparison.status !== "observed_match")
    throw new Error(
      "Wait for complete, exact native aggregation before advancing the test clock.",
    );
  if (
    input.reservedQuantity !== "0" ||
    input.local.groups.some(
      (group) =>
        group.validationErrorEventCount !== 0 ||
        group.effectiveScaledQuantity !==
          group.providerAcceptedScaledQuantity ||
        ["queued", "sending", "rejected", "unknown", "held"].some(
          (state) =>
            group.deliveryQuantities[
              state as keyof typeof group.deliveryQuantities
            ] !== "0",
        ),
    )
  )
    throw new Error(
      "Drain delivery and reservations before closing the original billing period.",
    );
  if (!input.corrections.isDone || input.corrections.legacyHistoryMissing)
    throw new Error("Complete correction history is required before billing.");
  const latest = new Map<string, Correction>();
  for (const row of input.corrections.records)
    if (!latest.has(row.key) || latest.get(row.key)!.sequence < row.sequence)
      latest.set(row.key, row);
  if ([...latest.values()].some((row) => row.state !== "confirmed"))
    throw new Error(
      "Resolve the original correction before advancing the test clock.",
    );
}
