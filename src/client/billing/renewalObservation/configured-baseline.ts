import { need, get, equal, type ObserverCandidateResult } from "./common.js";
import type { templates } from "./schedule-templates.js";
export function baseline(
  state: Extract<ReturnType<typeof templates>, { kind: "continue" }>["state"],
) {
  const {
    rawReads,
    base,
    purpose,
    originalItem,
    sub,
    current,
    currentOriginal,
    activeTarget,
    normalizeSub,
    sourceWithAssociation,
    targetPhase,
    comparableSchedule,
  } = state;
  // BEGIN original 851-879
  if (purpose === "baseline") {
    need(
      currentOriginal ||
        (activeTarget &&
          current.start_date === targetPhase.start_date &&
          current.end_date === targetPhase.end_date),
      "configured_ack_phase_relation_unproven",
      "unknown",
    );
    need(
      equal(
        normalizeSub(sub, "original", get(originalItem, "price")),
        normalizeSub(
          sourceWithAssociation,
          "original",
          get(originalItem, "price"),
        ),
      ),
      "historical_original_material_drift",
    );
    return {
      kind: "result" as const,
      result: {
        ...base,
        predicate: "configured_baseline_material_match",
        rawReads,
        comparableSchedule,
        proofTargetEnd: Number(targetPhase.end_date),
        proofStage: currentOriginal ? "original" : "target",
      } as ObserverCandidateResult,
    };
  }
  // END original 851-879
  return { kind: "continue" as const, state: { ...state } };
}
