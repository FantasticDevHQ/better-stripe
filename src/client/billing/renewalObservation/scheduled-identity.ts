import {
  Stop,
  object,
  array,
  need,
  get,
  equal,
  timestamp,
  planMatchesPrice,
  type ObserverCandidateResult,
} from "./common.js";
import type { references } from "./reference-catalog.js";
export function identities(state: ReturnType<typeof references>) {
  const {
    input,
    rawReads,
    base,
    projection,
    expected,
    receipt,
    originalSub,
    originalItem,
    originalSchedule,
    expectedPrice,
    schedule,
    sub,
    target,
    customer,
    context,
    ref,
  } = state;
  // BEGIN original 280-415
  need(
    planMatchesPrice(originalItem.plan, originalItem.price, context),
    "unproven_original_plan_price_mapping",
    "unknown",
  );
  const customerId = ref(originalSub.customer, "cus", "customer");
  need(
    schedule.id === receipt.scheduleId &&
      schedule.object === "subscription_schedule" &&
      schedule.customer_account === expected.customerAccountId &&
      schedule.livemode === expected.livemode &&
      ref(schedule.customer, "cus", "customer") === customerId,
    "owned_schedule_identity_mismatch",
  );
  need(
    sub.id === expected.subscriptionId &&
      sub.object === "subscription" &&
      sub.customer_account === expected.customerAccountId &&
      sub.livemode === expected.livemode &&
      ref(sub.customer, "cus", "customer") === customerId,
    "original_subscription_identity_mismatch",
  );
  need(
    customer.id === customerId &&
      customer.object === "customer" &&
      customer.customer_account === expected.customerAccountId &&
      customer.livemode === expected.livemode,
    "billing_customer_identity_mismatch",
  );
  for (const value of [schedule.customer, sub.customer])
    if (typeof value !== "string") {
      const expanded = object(value);
      if (
        !Object.keys(expanded).every((k) =>
          ["id", "object", "deleted", "livemode", "customer_account"].includes(
            k,
          ),
        )
      )
        need(equal(expanded, customer), "expanded_customer_read_drift");
    }
  for (const [expanded, correlated, kind] of [
    [sub.schedule, schedule, "subscription_schedule"],
    [schedule.subscription, sub, "subscription"],
  ] as const)
    if (expanded !== null && typeof expanded !== "string") {
      const full = object(expanded);
      if (
        !Object.keys(full).every((k) =>
          ["id", "object", "deleted", "livemode", "customer_account"].includes(
            k,
          ),
        )
      )
        need(equal(full, correlated), "expanded_" + kind + "_read_drift");
    }
  if (input.configureAcknowledgement !== undefined)
    throw new Stop("configure_ack_contract_unavailable", "unknown");
  if (
    ["canceled", "released", "completed", "not_started"].includes(
      String(schedule.status),
    )
  ) {
    if (schedule.subscription !== null)
      need(
        ref(schedule.subscription, "sub", "subscription") ===
          expected.subscriptionId,
        "terminal_original_relation_mismatch",
      );
    if (schedule.released_subscription !== null)
      need(
        schedule.released_subscription === expected.subscriptionId,
        "terminal_released_relation_mismatch",
      );
    return {
      kind: "result" as const,
      result: {
        ...base,
        predicate: "terminal_facts_only",
        providerStatus: schedule.status,
        effectiveness: "unknown",
        rawReads,
      } as ObserverCandidateResult,
    };
  }
  need(schedule.status === "active", "unsupported_schedule_status", "unknown");
  need(
    ref(schedule.subscription, "sub", "subscription") ===
      expected.subscriptionId &&
      ref(sub.schedule, "sub_sched", "subscription_schedule") ===
        receipt.scheduleId,
    "active_owned_association_mismatch",
  );
  need(equal(target, expectedPrice), "target_full_read_drift");
  need(
    equal(customer, projection.billingCustomer),
    "billing_customer_full_read_drift",
  );
  const items = get(sub, "items");
  need(
    items.has_more === false && array(items.data).length === 1,
    "incomplete_or_ambiguous_current_items",
    "unknown",
  );
  const actualItem = object(array(items.data)[0]);
  need(
    typeof actualItem.id === "string" &&
      /^si_[A-Za-z0-9_]+$/.test(actualItem.id) &&
      actualItem.subscription === expected.subscriptionId,
    "target_item_identity_mismatch",
  );
  const current = get(schedule, "current_phase");
  need(
    Object.keys(current).length === 2 &&
      Object.prototype.hasOwnProperty.call(current, "start_date") &&
      Object.prototype.hasOwnProperty.call(current, "end_date"),
    "unqualified_current_phase_shape",
    "unknown",
  );
  timestamp.parse(current.start_date);
  timestamp.parse(current.end_date);
  const phases = array(schedule.phases);
  const originalPhase = object(array(originalSchedule.phases)[0]);
  const currentOriginal =
    current.start_date === expected.periodStart &&
    current.end_date === expected.periodEnd;
  const activeTarget = current.start_date === expected.periodEnd;
  // END original 280-415
  return {
    kind: "continue" as const,
    state: {
      ...state,
      customerId,
      items,
      actualItem,
      current,
      phases,
      originalPhase,
      currentOriginal,
      activeTarget,
    },
  };
}
