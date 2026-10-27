import { z } from "zod";
import { idempotencyOptions } from "../../core/idempotency.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { retainedPreparation, validateReads } from "./preflight.js";
import { validateAttachReceipt } from "./receipt.js";
import { assemblePhases } from "./phases.js";
import {
  binding,
  object,
  configureInput,
  equal,
  conflict,
  unsupported,
  failure,
  referenceId,
} from "./shared.js";

export function projectRenewalConfiguration(input: unknown) {
  let ownedScheduleId: string | undefined;
  try {
    const args = configureInput.parse(renewalSnapshot(input));
    const prepared = retainedPreparation(args.prepared);
    const receipt = validateAttachReceipt(
      args.attachReceipt,
      prepared,
      args.apiVersion,
      args.observedAt,
    );
    ownedScheduleId = receipt.scheduleId;
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
    const reads = validateReads(args, receipt.scheduleId);
    const schedule = object(args.schedule);
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
    const request = {
      version: 1 as const,
      stage: "configure" as const,
      scope: "platform" as const,
      apiVersion: args.apiVersion,
      logicalBinding: prepared.requestIdentity.binding,
      scheduleId: receipt.scheduleId,
      method: "POST" as const,
      path: `/v1/subscription_schedules/${receipt.scheduleId}`,
      key,
      payload,
      firstDispatchedAt: args.firstDispatchedAt,
      attachReceiptBinding: receipt.binding,
      baselineBinding: binding("renewal-baseline", receipt.providerSnapshot),
      defaultSettingsBinding: binding(
        "renewal-defaults",
        schedule.default_settings,
      ),
    };
    return renewalSnapshot({
      ...request,
      status: "projected_configure_request" as const,
      providerQualification: "required" as const,
      profile: reads.profile,
      requestIdentity: { key, binding: binding("renewal-configure", request) },
    });
  } catch (error) {
    return failure(error, ownedScheduleId);
  }
}
