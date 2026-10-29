import { weeklyPending } from "./weeklyPending.js";
import {
  Stop,
  object,
  array,
  need,
  get,
  equal,
  type ObserverCandidateResult,
} from "./common.js";
import type { baseline } from "./configured-baseline.js";
export function pending(
  state: Extract<ReturnType<typeof baseline>, { kind: "continue" }>["state"],
) {
  const {
    rawReads,
    base,
    evidence,
    originalItem,
    sub,
    target,
    desired,
    actualItem,
    current,
    currentOriginal,
    activeTarget,
    normalizeSub,
    sourceWithAssociation,
    targetPhase,
    comparableSchedule,
  } = state;
  // BEGIN original 880-926
  if (evidence) {
    need(
      targetPhase.end_date === evidence.targetEnd &&
        equal(comparableSchedule, evidence.comparable),
      "configured_ack_full_baseline_drift",
    );
    need(
      !(evidence.stage === "target" && currentOriginal),
      "phase_regression_from_configured_ack",
      "unknown",
    );
  }
  if (currentOriginal) {
    need(
      equal(
        normalizeSub(sub, "original", get(originalItem, "price")),
        normalizeSub(
          sourceWithAssociation,
          "original",
          get(originalItem, "price"),
        ),
      ),
      "current_paid_material_drift",
    );
    if (evidence || weeklyPending(state))
      return {
        kind: "result" as const,
        result: {
          ...base,
          predicate: "confirmed_pending",
          rawReads,
        } as ObserverCandidateResult,
      };
    throw new Stop("future_duration_not_bound", "unknown");
  }
  need(
    activeTarget &&
      current.start_date === targetPhase.start_date &&
      current.end_date === targetPhase.end_date,
    "current_phase_target_relation_mismatch",
  );
  need(
    actualItem.current_period_start === current.start_date &&
      actualItem.current_period_end === current.end_date,
    "native_target_period_not_exact",
    "unknown",
  );
  need(
    equal(object(array(get(desired, "payload").phases)[1]).duration, {
      interval: get(target, "recurring").interval,
      interval_count: get(target, "recurring").interval_count,
    }),
    "target_native_interval_mismatch",
  );
  // END original 880-926
  return { kind: "continue" as const, state: { ...state } };
}
