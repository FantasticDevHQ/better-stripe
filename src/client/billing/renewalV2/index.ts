import { z } from "zod";
import {
  prepareRenewalPriceReplacement,
  type PrepareRenewalPriceReplacementOptions,
  type PreparedRenewalPriceReplacement,
} from "../renewalPriceReplacement.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { supportedVersion, timestamp } from "../renewalAggregate/shared.js";
import { idempotencyOptions } from "../../core/idempotency.js";
import { renewalBindingV2 } from "./binding.js";

export type PrepareRenewalPriceReplacementV2Options =
  PrepareRenewalPriceReplacementOptions;
export type PreparedRenewalPriceReplacementV2 = Omit<
  PreparedRenewalPriceReplacement,
  "version" | "requestIdentity"
> & {
  version: 2;
  requestIdentity: { key: string; binding: string };
};

/** Pure preparation. Protect retained full records under host authorization. */
export async function prepareRenewalPriceReplacementV2(
  options: PrepareRenewalPriceReplacementV2Options,
): Promise<PreparedRenewalPriceReplacementV2> {
  // Reuse the existing raw constructor's semantic checks, not a stored V1 claim.
  const original = prepareRenewalPriceReplacement(renewalSnapshot(options));
  const { status, preservation, requestIdentity, ...source } = original;
  const bound = { ...source, version: 2 as const };
  const binding = await renewalBindingV2("renewal", bound);
  return {
    ...bound,
    status,
    preservation,
    requestIdentity: { key: requestIdentity.key, binding },
  };
}

export type PrepareRenewalScheduleAttachmentV2Options = {
  prepared: unknown;
  apiVersion: string;
  attachKey: string;
  firstDispatchedAt: number;
};
export type PreparedRenewalScheduleAttachmentV2 = {
  version: 2;
  stage: "attach";
  scope: "platform";
  apiVersion: string;
  logicalBinding: string;
  method: "POST";
  path: "/v1/subscription_schedules";
  payload: { from_subscription: string };
  key: string;
  firstDispatchedAt: number;
  requestIdentity: { key: string; binding: string };
};
const attachInput = z
  .object({
    prepared: z.unknown(),
    apiVersion: z.string(),
    attachKey: z.string(),
    firstDispatchedAt: timestamp,
  })
  .strict();
const record = z.record(z.string(), z.unknown());

/** Pure C2 request. No dispatch, receipt, provider qualification or V1 migration. */
export async function prepareRenewalScheduleAttachmentV2(
  options: PrepareRenewalScheduleAttachmentV2Options,
): Promise<PreparedRenewalScheduleAttachmentV2> {
  // This detached capture includes every option and retained fact before await.
  const args = attachInput.parse(renewalSnapshot(options));
  supportedVersion(args.apiVersion);
  const key = idempotencyOptions(args.attachKey)?.idempotencyKey;
  if (!key) throw new Error("Renewal V2 requires an explicit attachment key.");
  const candidate = record.parse(args.prepared);
  if (candidate.version !== 2)
    throw new Error("Renewal V2 requires a V2 preparation.");
  const source = record.parse(candidate.providerSnapshot);
  const identity = record.parse(candidate.requestIdentity);
  const rebuilt = await prepareRenewalPriceReplacementV2({
    subscription: source.subscription,
    targetPrice: source.targetPrice,
    ...(source.billingCustomer === undefined
      ? {}
      : { billingCustomer: source.billingCustomer }),
    expected:
      candidate.expected as PrepareRenewalPriceReplacementOptions["expected"],
    key: z.string().parse(identity.key),
  });
  if (
    JSON.stringify(renewalSnapshot(rebuilt)) !==
    JSON.stringify(renewalSnapshot(candidate))
  )
    throw new Error("Renewal V2 preparation does not match its full source.");
  const request = {
    version: 2 as const,
    stage: "attach" as const,
    scope: "platform" as const,
    apiVersion: args.apiVersion,
    logicalBinding: rebuilt.requestIdentity.binding,
    method: "POST" as const,
    path: "/v1/subscription_schedules" as const,
    payload: { from_subscription: rebuilt.expected.subscriptionId },
    key,
    firstDispatchedAt: args.firstDispatchedAt,
  };
  const binding = await renewalBindingV2("renewal-attach", request);
  return { ...request, requestIdentity: { key, binding } };
}
