import {
  object,
  array,
  need,
  clone,
  get,
  equal,
  timestamp,
  planTemplateForPrice,
  type ObserverCandidateResult,
} from "./common.js";
import type { pending } from "./pending-and-stage.js";
export function active(
  state: Extract<ReturnType<typeof pending>, { kind: "continue" }>["state"],
): ObserverCandidateResult {
  const {
    rawReads,
    base,
    originalItem,
    sub,
    target,
    context,
    actualItem,
    current,
    actualItemDiscounts,
    normalizeSub,
    sourceWithAssociation,
    targetTemplate,
  } = state;
  // BEGIN original 927-961
  const effectiveTemplate = clone(sourceWithAssociation),
    expectedItem = clone(originalItem);
  expectedItem.id = actualItem.id;
  expectedItem.price = clone(target);
  const targetPlanTemplate = planTemplateForPrice(target, context);
  need(targetPlanTemplate, "unproven_target_plan_price_mapping", "unknown");
  // Expected comparison view from explicit field mapping; raw actual Plan stays in rawReads.
  expectedItem.plan = targetPlanTemplate;
  expectedItem.current_period_start = current.start_date;
  expectedItem.current_period_end = current.end_date;
  get(effectiveTemplate, "items").data = [expectedItem];
  if (targetTemplate.billing_cycle_anchor === "phase_start")
    effectiveTemplate.billing_cycle_anchor = current.start_date;
  const normalizedActual = normalizeSub(sub, "target", target),
    normalizedExpected = normalizeSub(effectiveTemplate, "original", target);
  get(normalizedExpected, "items").data = [
    {
      ...object(array(get(normalizedExpected, "items").data)[0]),
      discounts: actualItemDiscounts,
    },
  ];
  need(
    equal(normalizedActual, normalizedExpected),
    "effective_full_material_drift",
  );
  return {
    ...base,
    predicate: "active_effective_match",
    observedItemId: String(actualItem.id),
    nativePeriod: {
      start: timestamp.parse(current.start_date),
      end: timestamp.parse(current.end_date),
    },
    rawReads,
  };
  // END original 927-961
}
