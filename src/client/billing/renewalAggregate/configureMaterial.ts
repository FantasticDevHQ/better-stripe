import { z } from "zod";
import type Stripe from "stripe";
import { idempotencyOptions } from "../../core/idempotency.js";
import { assemblePhases } from "./phases.js";
import type {
  RenewalPreparationMaterial,
  RenewalReadMaterial,
} from "./readMaterial.js";
import {
  object,
  configureInput,
  equal,
  conflict,
  unsupported,
  referenceId,
  type ObjectData,
} from "./shared.js";
type Args = Pick<
  z.infer<typeof configureInput>,
  | "configureKey"
  | "firstDispatchedAt"
  | "observedAt"
  | "freshSubscription"
  | "schedule"
>;
type Receipt = {
  scheduleId: string;
  providerSnapshot: unknown;
  request: { firstDispatchedAt: number; requestIdentity: { key: string } };
};
// Internal only: all callers validate their own receipt before entering these predicates.
export function validateConfigureStart(args: Args, receipt: Receipt) {
  const key = idempotencyOptions(args.configureKey)?.idempotencyKey;
  if (!key || key === receipt.request.requestIdentity.key)
    unsupported("configure_key_must_be_distinct");
  if (
    args.firstDispatchedAt > args.observedAt ||
    args.firstDispatchedAt < receipt.request.firstDispatchedAt
  )
    unsupported("invalid_retained_dispatch_time");
  const rawSubscription = object(args.freshSubscription);
  if (
    rawSubscription.schedule == null ||
    referenceId(
      rawSubscription.schedule,
      "sub_sched",
      "subscription_schedule",
    ) !== receipt.scheduleId
  )
    conflict("schedule_association_mismatch");
  return key;
}
export function configureMaterial(
  schedule: ObjectData,
  prepared: RenewalPreparationMaterial,
  receipt: Receipt,
  reads: RenewalReadMaterial,
): {
  schedule: ObjectData;
  payload: {
    end_behavior: "release";
    proration_behavior: "none";
    phases: [
      Stripe.SubscriptionScheduleUpdateParams.Phase,
      Stripe.SubscriptionScheduleUpdateParams.Phase,
    ];
  };
} {
  if (!equal(schedule, receipt.providerSnapshot))
    conflict("acknowledged_baseline_or_defaults_drift");
  const expected = prepared.expected;
  const referenceContext = {
    livemode: expected.livemode,
    customerAccountId: expected.customerAccountId,
  };
  if (
    schedule.id !== receipt.scheduleId ||
    schedule.object !== "subscription_schedule" ||
    schedule.customer_account !== expected.customerAccountId ||
    schedule.livemode !== expected.livemode ||
    referenceId(schedule.customer, "cus", "customer", referenceContext) !==
      reads.customer.id ||
    referenceId(
      schedule.subscription,
      "sub",
      "subscription",
      referenceContext,
    ) !== expected.subscriptionId
  )
    conflict("acknowledged_schedule_identity_mismatch");
  if (
    schedule.status !== "active" ||
    schedule.end_behavior !== "release" ||
    schedule.application !== null ||
    schedule.canceled_at !== null ||
    schedule.completed_at !== null ||
    schedule.released_at !== null ||
    schedule.released_subscription !== null ||
    (schedule.pause_schedules !== undefined &&
      (!Array.isArray(schedule.pause_schedules) ||
        schedule.pause_schedules.length))
  )
    unsupported("unsupported_acknowledged_schedule_state");
  if (!equal(schedule.billing_mode, reads.subscription.billing_mode))
    unsupported("schedule_billing_mode_mismatch");
  const current = z
    .object({ start_date: z.number(), end_date: z.number() })
    .strict()
    .parse(schedule.current_phase);
  if (
    current.start_date !== expected.periodStart ||
    current.end_date !== expected.periodEnd
  )
    conflict("current_phase_period_drift");
  const phases = assemblePhases(reads, schedule);
  const payload = {
    end_behavior: "release" as const,
    proration_behavior: "none" as const,
    phases,
  };
  return { schedule, payload };
}
