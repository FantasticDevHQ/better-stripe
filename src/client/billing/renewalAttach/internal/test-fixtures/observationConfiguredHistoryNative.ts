import type { declarePreflightCase } from "./configurePreflightControls.js";
type Baseline = ReturnType<typeof declarePreflightCase>;
export type ConfiguredHistoryWriterMode =
  | "configured-history"
  | "configured-history-onephase"
  | "configured-history-drift";
export const CONFIGURED_TARGET_SECONDS = 2419200;

/** Exact full native Plan mapping from the accepted baseline helper; DATA only. */
function targetPlan(p: Baseline["baselineBundle"]["wireTargetPrice"]) {
  return {
    id: p.id,
    object: "plan",
    active: p.active,
    amount: p.unit_amount,
    amount_decimal: p.unit_amount_decimal,
    billing_scheme: "per_unit",
    created: p.created,
    currency: p.currency,
    interval: p.recurring.interval,
    interval_count: p.recurring.interval_count,
    livemode: p.livemode,
    metadata: p.metadata,
    meter: p.recurring.meter,
    nickname: p.nickname,
    product: p.product,
    tiers_mode: null,
    transform_usage: null,
    trial_period_days: p.recurring.trial_period_days,
    usage_type: "licensed",
  };
}
/** Fixed complete reply recipe precedes all Source/Owner/C1/C2 construction. */
export function configuredHistoryResponse(
  baseline: Baseline,
  mode: ConfiguredHistoryWriterMode,
) {
  const response = structuredClone(baseline.schedule);
  const original = response.phases[0]!;
  const target = {
    ...structuredClone(original),
    start_date: baseline.original.attachRequest.preparation.expected.periodEnd,
    end_date:
      baseline.original.attachRequest.preparation.expected.periodEnd +
      CONFIGURED_TARGET_SECONDS,
    proration_behavior: "none",
    billing_cycle_anchor: "automatic",
    items: original.items.map((item) => ({
      ...structuredClone(item),
      price: "price_target",
      plan: "price_target",
    })),
    metadata:
      mode === "configured-history-drift"
        ? { ...original.metadata, declared: "TEST_HISTORY_PHASE_DRIFT" }
        : structuredClone(original.metadata),
  };
  return {
    ...response,
    phases:
      mode === "configured-history-onephase" ? [original] : [original, target],
  };
}
export function configuredHistoryLiveReads(
  baseline: Baseline,
  active: boolean,
) {
  // The independently declared live Schedule is always the clean complete history.
  const schedule = configuredHistoryResponse(baseline, "configured-history");
  const subscription = structuredClone(
    baseline.baselineBundle.wireSubscription,
  );
  const targetPrice = structuredClone(baseline.baselineBundle.wireTargetPrice);
  if (active) {
    const target = schedule.phases[1]!;
    schedule.current_phase = {
      start_date: target.start_date,
      end_date: target.end_date,
    };
    const item = subscription.items.data[0]!;
    item.id = "si_successor";
    item.price = structuredClone(targetPrice);
    item.plan = targetPlan(targetPrice);
    item.current_period_start = target.start_date;
    item.current_period_end = target.end_date;
    for (const discount of item.discounts) discount.subscription_item = item.id;
  }
  return {
    schedule,
    subscription,
    targetPrice,
    billingCustomer: structuredClone(
      baseline.baselineBundle.wireBillingCustomer,
    ),
    coupons: baseline.baselineBundle.couponReads.map((row) =>
      structuredClone(row.wireCoupon),
    ),
  };
}
