import type { ConfiguredEvidenceV1 } from "./evidence-material.js";
import type {
  IdentityV1,
  LifecycleV1,
  Presence,
  TerminalFactsV1,
} from "./evidence-v1-types.js";
import {
  object,
  array,
  get,
  equal,
  clone,
  referenceId,
  planMatchesPrice,
  type O,
} from "./common.js";
import { weeklyPending } from "./weeklyPending.js";

type Input = {
  identity: IdentityV1;
  reads: O;
  originalSchedule: unknown;
  originalSub: O;
  originalCustomer: unknown;
  target: unknown;
  desired: unknown;
  configured: ConfiguredEvidenceV1;
};
const owns = (value: O, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function presence<T>(
  value: O,
  key: string,
  parse: (raw: unknown) => T,
): Presence<T> {
  return owns(value, key)
    ? { presence: "present", value: parse(value[key]) }
    : { presence: "absent" };
}
function nullableTime(raw: unknown) {
  if (raw === null || timestamp(raw)) return raw;
  throw Error("invalid_terminal_field");
}
/** Full comparison view changes only named lifecycle fields, never raw reads. */
function historyView(
  schedule: O,
  originalPrice: O,
  target: O,
  context: {
    customerAccountId: string;
    livemode: boolean;
  },
) {
  const view = clone(schedule);
  for (const key of [
    "status",
    "subscription",
    "current_phase",
    "canceled_at",
    "completed_at",
    "released_at",
    "released_subscription",
  ])
    delete view[key];
  view.customer = referenceId(view.customer, "cus", "customer", context);
  view.phases = array(view.phases).map((raw) => {
    const phase = clone(object(raw));
    const items = array(phase.items);
    if (items.length !== 1) throw Error("terminal_completion_unproven");
    phase.items = items.map((rawItem) => {
      const item = clone(object(rawItem));
      const id = referenceId(item.price, "price", "price", context);
      const known =
        id === originalPrice.id
          ? originalPrice
          : id === target.id
            ? target
            : null;
      if (!known) throw Error("material_mismatch");
      if (typeof item.price !== "string") {
        const expanded = object(item.price);
        const minimal = Object.keys(expanded).every((key) =>
          ["id", "object", "deleted", "livemode", "customer_account"].includes(
            key,
          ),
        );
        if (!minimal && !equal(expanded, known))
          throw Error("material_mismatch");
      }
      item.price = id;
      if (owns(item, "plan")) {
        if (typeof item.plan === "string") {
          if (item.plan !== id) throw Error("material_mismatch");
        } else if (!planMatchesPrice(item.plan, known, context))
          throw Error("terminal_completion_unproven");
        item.plan = id;
      }
      return item;
    });
    return phase;
  });
  return view;
}
/** Unsigned facts and a narrow complete owned history comparison only. */
export function inspectTerminalEvidenceV1(input: Input): LifecycleV1 {
  let providerStatus: string | null = null;
  let facts: TerminalFactsV1 | null = null;
  const fail = (
    reason:
      | "invalid_terminal_field"
      | "owned_identity_mismatch"
      | "material_mismatch"
      | "terminal_completion_unproven"
      | "incomplete_material"
      | "unsupported_profile",
    conflict = false,
  ): LifecycleV1 => ({
    predicate: conflict ? "conflict" : "unknown",
    providerStatus,
    facts,
    completion: null,
    reason,
  });
  try {
    const { identity } = input;
    const schedule = get(input.reads, "schedule");
    const sub = get(input.reads, "subscription");
    const customer = get(input.reads, "billingCustomer");
    const context = {
      customerAccountId: identity.customerAccountId,
      livemode: identity.livemode,
    };
    providerStatus =
      typeof schedule.status === "string" ? schedule.status : null;
    const relation = (raw: unknown) => {
      if (raw === null) return null;
      const id = referenceId(raw, "sub", "subscription", context);
      if (typeof raw !== "string") {
        const expanded = object(raw);
        if (
          !Object.keys(expanded).every((key) =>
            [
              "id",
              "object",
              "deleted",
              "livemode",
              "customer_account",
            ].includes(key),
          ) &&
          !equal(expanded, sub)
        )
          throw Error("owned_identity_mismatch");
      }
      return id;
    };
    facts = {
      canceledAt: presence(schedule, "canceled_at", nullableTime),
      completedAt: presence(schedule, "completed_at", nullableTime),
      releasedAt: presence(schedule, "released_at", nullableTime),
      subscriptionId: presence(schedule, "subscription", relation),
      releasedSubscriptionId: presence(
        schedule,
        "released_subscription",
        relation,
      ),
    };
    const customerId = (raw: unknown) =>
      referenceId(raw, "cus", "customer", context);
    if (
      schedule.id !== identity.scheduleId ||
      schedule.object !== "subscription_schedule" ||
      schedule.customer_account !== identity.customerAccountId ||
      schedule.livemode !== identity.livemode ||
      customerId(schedule.customer) !== identity.customerId ||
      sub.id !== identity.subscriptionId ||
      sub.object !== "subscription" ||
      sub.customer_account !== identity.customerAccountId ||
      sub.livemode !== identity.livemode ||
      customerId(sub.customer) !== identity.customerId ||
      customer.id !== identity.customerId ||
      customer.object !== "customer" ||
      customer.customer_account !== identity.customerAccountId ||
      customer.livemode !== identity.livemode
    )
      return fail("owned_identity_mismatch", true);
    for (const field of [facts.subscriptionId, facts.releasedSubscriptionId])
      if (
        field.presence === "present" &&
        field.value !== null &&
        field.value !== identity.subscriptionId
      )
        return fail("owned_identity_mismatch", true);
    if (
      input.configured.predicate === "unknown" ||
      input.configured.predicate === "conflict"
    )
      return fail(
        input.configured.reason === "material_mismatch"
          ? "material_mismatch"
          : input.configured.reason === "incomplete_material"
            ? "incomplete_material"
            : "terminal_completion_unproven",
        input.configured.predicate === "conflict",
      );
    if (providerStatus === "active" || providerStatus === "not_started")
      return {
        predicate: "status_only",
        providerStatus,
        facts: null,
        completion: null,
        reason: null,
      };
    if (providerStatus === "canceled" || providerStatus === "released")
      return {
        predicate: "status_only",
        providerStatus,
        facts,
        completion: null,
        reason: null,
      };
    if (providerStatus !== "completed") return fail("unsupported_profile");
    if (
      facts.completedAt.presence !== "present" ||
      facts.completedAt.value === null ||
      !owns(schedule, "current_phase") ||
      schedule.current_phase !== null
    )
      return fail("terminal_completion_unproven");
    // Unknown nullable presence is not silently rewritten to null for comparison.
    if (Object.values(facts).some((field) => field.presence !== "present"))
      return fail("terminal_completion_unproven");
    const original = object(input.originalSchedule);
    const originalPhase = object(array(original.phases)[0]);
    const phases = array(schedule.phases);
    if (phases.length !== 2) return fail("terminal_completion_unproven");
    const targetPhase = object(phases[1]);
    if (
      schedule.end_behavior !== "release" ||
      !timestamp(targetPhase.end_date) ||
      targetPhase.start_date !== identity.targetBoundary ||
      targetPhase.end_date <= identity.targetBoundary ||
      facts.completedAt.value < targetPhase.end_date
    )
      return fail("terminal_completion_unproven");
    if (!equal(customer, input.originalCustomer))
      return fail("material_mismatch", true);
    for (const raw of [schedule.customer, sub.customer]) {
      if (typeof raw !== "string") {
        const expanded = object(raw);
        if (
          !Object.keys(expanded).every((key) =>
            [
              "id",
              "object",
              "deleted",
              "livemode",
              "customer_account",
            ].includes(key),
          ) &&
          !equal(expanded, customer)
        )
          return fail("material_mismatch", true);
      }
    }
    const originalItem = object(array(get(input.originalSub, "items").data)[0]);
    const retainedCoupons = new Map<string, unknown>();
    for (const raw of [
      ...array(input.originalSub.discounts),
      ...array(originalItem.discounts),
    ]) {
      const coupon = get(get(object(raw), "source"), "coupon");
      if (
        typeof coupon.id !== "string" ||
        (retainedCoupons.has(coupon.id) &&
          !equal(retainedCoupons.get(coupon.id), coupon))
      )
        return fail("terminal_completion_unproven");
      retainedCoupons.set(coupon.id, coupon);
    }
    const coupons = array(input.reads.coupons);
    const seenCoupons = new Set<string>();
    for (const raw of coupons) {
      const coupon = object(raw);
      if (
        typeof coupon.id !== "string" ||
        seenCoupons.has(coupon.id) ||
        !retainedCoupons.has(coupon.id)
      )
        return fail("terminal_completion_unproven");
      if (!equal(coupon, retainedCoupons.get(coupon.id)))
        return fail("material_mismatch", true);
      seenCoupons.add(coupon.id);
    }
    if (seenCoupons.size !== retainedCoupons.size)
      return fail("terminal_completion_unproven");
    const target = object(input.target);
    if (!equal(target, input.reads.targetPrice))
      return fail("material_mismatch", true);
    const desired = object(input.desired);
    const expected = { periodEnd: identity.targetBoundary };
    if (
      !weeklyPending({
        desired,
        originalSub: input.originalSub,
        sub,
        expected,
        target,
        targetPhase,
        schedule,
        phases,
      })
    )
      return fail("terminal_completion_unproven");
    const targetTemplate = clone(originalPhase);
    targetTemplate.start_date = identity.targetBoundary;
    targetTemplate.end_date = targetPhase.end_date;
    targetTemplate.proration_behavior = "none";
    targetTemplate.billing_cycle_anchor = object(
      array(get(desired, "payload").phases)[1],
    ).billing_cycle_anchor;
    const item = clone(object(array(targetTemplate.items)[0]));
    item.price = identity.targetPriceId;
    if (owns(item, "plan")) item.plan = identity.targetPriceId;
    targetTemplate.items = [item];
    const template = clone(original);
    template.phases = [clone(originalPhase), targetTemplate];
    const originalPrice = get(
      object(array(get(input.originalSub, "items").data)[0]),
      "price",
    );
    const actual = historyView(schedule, originalPrice, target, context);
    if (!equal(actual, historyView(template, originalPrice, target, context)))
      return fail("material_mismatch", true);
    if (
      input.configured.predicate === "qualified" &&
      (targetPhase.end_date !== input.configured.targetEnd ||
        !equal(
          actual,
          historyView(
            input.configured.snapshot,
            originalPrice,
            target,
            context,
          ),
        ))
    )
      return fail("material_mismatch", true);
    return {
      predicate: "completed_correlated",
      providerStatus: "completed",
      facts,
      completion: {
        scheduleId: identity.scheduleId,
        subscriptionId: identity.subscriptionId,
        completedAt: facts.completedAt.value,
        targetPeriod: {
          start: identity.targetBoundary,
          end: targetPhase.end_date,
        },
        finalPhaseEnd: targetPhase.end_date,
        endBehavior: "release",
        comparison: "full_normalized_phase_history_match",
      },
      reason: null,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "owned_identity_mismatch")
      return fail("owned_identity_mismatch", true);
    if (error instanceof Error && error.message === "material_mismatch")
      return fail("material_mismatch", true);
    if (error instanceof Error && error.message === "invalid_terminal_field")
      return fail("invalid_terminal_field");
    return fail("terminal_completion_unproven");
  }
}
