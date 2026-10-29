import {
  object,
  array,
  need,
  clone,
  get,
  equal,
  timestamp,
  type ObserverCandidateResult,
} from "./common.js";
import type { normalize } from "./scheduled-normalization.js";
export function templates(state: ReturnType<typeof normalize>) {
  const {
    rawReads,
    base,
    expected,
    receipt,
    originalSub,
    originalItem,
    originalSchedule,
    schedule,
    sub,
    target,
    desired,
    current,
    phases,
    originalPhase,
    currentOriginal,
    normalizePhase,
    normalizeSchedule,
    normalizeSub,
  } = state;
  // BEGIN original 788-850
  const sourceWithAssociation = clone(originalSub);
  sourceWithAssociation.schedule = receipt.scheduleId;
  const attachedTemplate = normalizeSchedule(originalSchedule);
  attachedTemplate.phases = [
    normalizePhase(originalPhase, get(originalItem, "price")),
  ];
  const candidateSchedule = normalizeSchedule(schedule);
  if (phases.length === 1 && currentOriginal) {
    candidateSchedule.phases = [
      normalizePhase(object(phases[0]), get(originalItem, "price")),
    ];
    need(
      equal(candidateSchedule, attachedTemplate) &&
        equal(
          normalizeSub(sub, "original", get(originalItem, "price")),
          normalizeSub(
            sourceWithAssociation,
            "original",
            get(originalItem, "price"),
          ),
        ),
      "unconfigured_material_drift",
    );
    return {
      kind: "result" as const,
      result: {
        ...base,
        predicate: "attached_unconfigured_match",
        rawReads,
      } as ObserverCandidateResult,
    };
  }
  need(phases.length === 2, "raw_phase_history_unavailable", "unknown");
  const targetPhase = object(phases[1]);
  need(
    targetPhase.start_date === expected.periodEnd &&
      typeof targetPhase.end_date === "number" &&
      targetPhase.end_date > Number(expected.periodEnd),
    "target_phase_boundary_mismatch",
  );
  const targetTemplate = clone(originalPhase);
  targetTemplate.start_date = expected.periodEnd;
  targetTemplate.end_date = targetPhase.end_date;
  targetTemplate.proration_behavior = "none";
  targetTemplate.billing_cycle_anchor = object(
    array(get(desired, "payload").phases)[1],
  ).billing_cycle_anchor;
  const targetTemplateItem = object(array(targetTemplate.items)[0]);
  targetTemplateItem.price = expected.targetPriceId;
  if (targetTemplateItem.plan !== undefined)
    targetTemplateItem.plan = expected.targetPriceId;
  targetTemplate.items = [targetTemplateItem];
  const completeTemplate = clone(attachedTemplate);
  completeTemplate.phases = [
    normalizePhase(originalPhase, get(originalItem, "price")),
    normalizePhase(targetTemplate, target),
  ];
  completeTemplate.current_phase = clone(current);
  candidateSchedule.phases = [
    normalizePhase(object(phases[0]), get(originalItem, "price")),
    normalizePhase(targetPhase, target),
  ];
  need(
    equal(candidateSchedule, completeTemplate),
    "full_phase_or_default_read_drift",
  );
  // Separate comparison view. This is NOT a provider read or rewritten ACK.
  const comparableSchedule = clone(candidateSchedule);
  comparableSchedule.current_phase = "NAMED_STAGE_PROGRESS_ONLY";
  timestamp.parse(targetPhase.end_date);
  // END original 788-850
  return {
    kind: "continue" as const,
    state: {
      ...state,
      sourceWithAssociation,
      attachedTemplate,
      candidateSchedule,
      targetPhase,
      targetTemplate,
      completeTemplate,
      comparableSchedule,
    },
  };
}
