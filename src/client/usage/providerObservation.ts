import type Stripe from "stripe";
import { UsageCatalogError } from "./catalogTypes.js";
import { decimalFromScaled } from "./summary.js";
import {
  observationOptions,
  verifyObservationSource,
  type UsageObservationOptions,
  type UsageAggregateObservation,
} from "./observationTypes.js";
export async function observeProviderUsage(
  stripe: Stripe,
  input: UsageObservationOptions,
): Promise<UsageAggregateObservation> {
  const opts = observationOptions(input),
    observedAt = Math.floor(Date.now() / 1000);
  const unavailable = (reason: string): UsageAggregateObservation => ({
    status: "unavailable",
    reason,
    retryable: true,
  });
  if (opts.period.start % 60 || opts.period.end % 60)
    return {
      status: "unsupported",
      reason: "minute_alignment_required",
      retryable: false,
    };
  try {
    if (!(await verifyObservationSource(stripe, opts)))
      return {
        status: "unsupported",
        reason: "provider_binding_mismatch",
        retryable: false,
      };
    const result = await stripe.billing.meters.listEventSummaries(
      opts.scope.meterId,
      {
        customer: opts.binding.stripeCustomerId,
        start_time: opts.period.start,
        end_time: opts.period.end,
        limit: opts.limit,
        starting_after: opts.cursor ?? undefined,
      },
    );
    if (!result.data.length)
      return unavailable(
        result.has_more ? "provider_history_incomplete" : "aggregation_pending",
      );
    if (result.data.length > opts.limit)
      return unavailable("provider_history_incomplete");
    const seen = new Set<string>();
    let scaled = 0n;
    const intervals: Array<{ start: number; end: number }> = [],
      entries: Array<{
        id: string;
        start: number;
        end: number;
        scaledQuantity: string;
      }> = [];
    for (const summary of result.data) {
      if (
        summary.object !== "billing.meter_event_summary" ||
        summary.meter !== opts.scope.meterId ||
        summary.livemode !== opts.scope.livemode ||
        !summary.id ||
        summary.id.length > 2048 ||
        seen.has(summary.id) ||
        !Number.isSafeInteger(summary.start_time) ||
        !Number.isSafeInteger(summary.end_time) ||
        summary.start_time < opts.period.start ||
        summary.end_time > opts.period.end ||
        summary.end_time <= summary.start_time ||
        intervals.some(
          (w) => summary.start_time < w.end && summary.end_time > w.start,
        )
      )
        return unavailable("provider_history_incomplete");
      if (
        !Number.isSafeInteger(summary.aggregated_value) ||
        summary.aggregated_value < 0
      )
        return unavailable("provider_precision_unsupported");
      seen.add(summary.id);
      intervals.push({ start: summary.start_time, end: summary.end_time });
      const value = BigInt(summary.aggregated_value);
      scaled += value;
      entries.push({
        id: summary.id,
        start: summary.start_time,
        end: summary.end_time,
        scaledQuantity: value.toString(),
      });
    }
    const covered =
      intervals.reduce((sum, w) => sum + w.end - w.start, 0) ===
      opts.period.end - opts.period.start;
    return {
      status: "available",
      observedAt,
      value: {
        period: opts.period,
        quantity: decimalFromScaled(scaled, opts.binding.plan.unit.precision),
        scaledQuantity: scaled.toString(),
        complete: !result.has_more && opts.cursor === null && covered,
        nextCursor: result.has_more
          ? result.data[result.data.length - 1].id
          : null,
        aggregationLagPossible: true,
        stale: false,
        entries,
      },
    };
  } catch (error) {
    if (
      error instanceof UsageCatalogError &&
      error.code === "unsupported_scope"
    )
      return {
        status: "unsupported",
        reason: "unsupported_scope",
        retryable: false,
      };
    return unavailable("provider_unavailable");
  }
}
