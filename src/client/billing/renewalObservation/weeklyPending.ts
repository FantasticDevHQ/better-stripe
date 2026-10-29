import { object, get, array, need, type O } from "./common.js";
function noReset(sub: O) {
  return (
    sub.billing_cycle_anchor_config === null &&
    sub.trial_start === null &&
    sub.trial_end === null &&
    sub.billing_thresholds === null &&
    sub.cancel_at === null &&
    sub.canceled_at === null &&
    sub.cancel_at_period_end === false &&
    sub.pending_update === null &&
    sub.pause_collection === null &&
    array(get(sub, "items").data).every((x) => {
      const i = object(x);
      return (
        i.billing_thresholds === null &&
        (i.current_trial === null ||
          !Object.prototype.hasOwnProperty.call(i, "current_trial"))
      );
    })
  );
}
/** Narrow UTC-week inference. Never takes an expected end or caller evidence. */
export function weeklyPending(state: {
  desired: O;
  originalSub: O;
  sub: O;
  expected: O;
  target: O;
  targetPhase: O;
  schedule: O;
  phases: unknown[];
}) {
  const profile = get(state.desired, "profile"),
    target = get(state.target, "recurring");
  if (
    profile.billingMode !== "classic" ||
    profile.cadence !== "changed" ||
    profile.anchor !== "ordinary" ||
    target.interval !== "week" ||
    target.interval_count !== 1 ||
    target.usage_type !== "licensed" ||
    state.schedule.end_behavior !== "release" ||
    !noReset(state.originalSub) ||
    !noReset(state.sub)
  )
    return false;
  const phases = array(get(state.desired, "payload").phases),
    desired = object(phases[1]),
    duration = get(desired, "duration");
  if (
    duration.interval !== "week" ||
    duration.interval_count !== 1 ||
    desired.billing_cycle_anchor !== "phase_start" ||
    state.targetPhase.billing_cycle_anchor !== "phase_start" ||
    !state.phases.every((p) => {
      const phase = object(p);
      return (
        phase.trial === false &&
        phase.trial_end === null &&
        phase.billing_thresholds === null
      );
    })
  )
    return false;
  const start = state.expected.periodEnd;
  if (
    !Number.isSafeInteger(start) ||
    typeof start !== "number" ||
    start < 0 ||
    !Number.isSafeInteger(start + 604800)
  )
    return false;
  const expectedEnd = start + 604800;
  need(
    state.targetPhase.start_date === start &&
      state.targetPhase.end_date === expectedEnd,
    "target_phase_duration_mismatch",
  );
  return true;
}
