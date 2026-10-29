import type Stripe from "stripe";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { retainedPreparation, validateReads } from "./preflight.js";
import { validateAttachReceipt } from "./receipt.js";
import {
  configureMaterial,
  validateConfigureStart,
} from "./configureMaterial.js";
import type { RenewalProfile } from "./profile.js";
import {
  binding,
  configureInput,
  failure,
  object,
  type Failure,
} from "./shared.js";

export type ProjectedRenewalConfiguration = {
  version: 1;
  stage: "configure";
  scope: "platform";
  apiVersion: string;
  logicalBinding: string;
  scheduleId: string;
  method: "POST";
  path: string;
  key: string;
  payload: {
    end_behavior: "release";
    proration_behavior: "none";
    phases: [
      Stripe.SubscriptionScheduleUpdateParams.Phase,
      Stripe.SubscriptionScheduleUpdateParams.Phase,
    ];
  };
  firstDispatchedAt: number;
  attachReceiptBinding: string;
  baselineBinding: string;
  defaultSettingsBinding: string;
  status: "projected_configure_request";
  providerQualification: "required";
  profile: RenewalProfile;
  requestIdentity: { key: string; binding: string };
};

export function projectRenewalConfiguration(
  input: unknown,
): ProjectedRenewalConfiguration | Failure {
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
    const key = validateConfigureStart(args, receipt);
    const reads = validateReads(args, receipt.scheduleId);
    const { schedule, payload } = configureMaterial(
      object(args.schedule),
      prepared,
      receipt,
      reads,
    );
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
