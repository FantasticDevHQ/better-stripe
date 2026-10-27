import { z } from "zod";
import { retainedPreparation } from "../renewalAggregate/preflight.js";
import {
  binding,
  supportedVersion,
  timestamp,
  unsupported,
} from "../renewalAggregate/shared.js";
import { idempotencyOptions } from "../../core/idempotency.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";

const input = z
  .object({
    prepared: z.unknown(),
    apiVersion: z.string(),
    attachKey: z.string(),
    firstDispatchedAt: timestamp,
  })
  .strict();
export type PrepareRenewalScheduleAttachmentOptions = z.infer<typeof input>;
/** Pure retained request only. It neither authorizes nor dispatches attachment. */
export function prepareRenewalScheduleAttachment(
  options: PrepareRenewalScheduleAttachmentOptions,
) {
  const args = input.parse(renewalSnapshot(options));
  supportedVersion(args.apiVersion);
  const prepared = retainedPreparation(args.prepared);
  const key = idempotencyOptions(args.attachKey)?.idempotencyKey;
  if (!key) unsupported("missing_explicit_attach_key");
  const request = {
    version: 1 as const,
    stage: "attach" as const,
    scope: "platform" as const,
    apiVersion: args.apiVersion,
    logicalBinding: prepared.requestIdentity.binding,
    method: "POST" as const,
    path: "/v1/subscription_schedules" as const,
    payload: { from_subscription: prepared.expected.subscriptionId },
    key,
    firstDispatchedAt: args.firstDispatchedAt,
  };
  return renewalSnapshot({
    ...request,
    requestIdentity: { key, binding: binding("renewal-attach", request) },
  });
}
export type PreparedRenewalScheduleAttachment = ReturnType<
  typeof prepareRenewalScheduleAttachment
>;
