import { z } from "zod";
import {
  prepareRenewalPriceReplacement,
  type PrepareRenewalPriceReplacementOptions,
  type PreparedRenewalPriceReplacement,
} from "../renewalPriceReplacement.js";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import {
  supportedVersion,
  timestamp,
  resourceId,
  equal,
  conflict,
  failure,
  type Failure,
} from "../renewalAggregate/shared.js";
import { validateReadMaterial } from "../renewalAggregate/readMaterial.js";
import {
  configureMaterial,
  validateConfigureStart,
} from "../renewalAggregate/configureMaterial.js";
import type { ProjectedRenewalConfiguration } from "../renewalAggregate/configure.js";
import { idempotencyOptions } from "../../core/idempotency.js";
import { renewalBindingV2 } from "./binding.js";
import {
  captureAttachmentReceipt,
  assertAttachmentIdentity,
} from "./receipt.js";
import { captureConfiguration } from "./configureInput.js";

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

export type ConstructRenewalScheduleAttachmentReceiptV2Options = {
  attachRequest: {
    preparation: PrepareRenewalPriceReplacementV2Options;
    apiVersion: string;
    attachKey: string;
    firstDispatchedAt: number;
  };
  actualDispatch: Pick<
    PreparedRenewalScheduleAttachmentV2,
    | "scope"
    | "apiVersion"
    | "method"
    | "path"
    | "payload"
    | "key"
    | "firstDispatchedAt"
  >;
  providerSnapshot: Record<string, unknown>;
};
export type RenewalScheduleAttachmentReceiptV2 = {
  version: 2;
  stage: "attached_unconfigured";
  scope: "platform";
  logicalBinding: string;
  request: PreparedRenewalScheduleAttachmentV2;
  scheduleId: string;
  subscriptionId: string;
  customerAccountId: string;
  livemode: boolean;
  providerSnapshot: Record<string, unknown>;
  binding: string;
};

/** Pure unsigned consistency data. Does not authenticate or acknowledge a POST. */
export async function constructRenewalScheduleAttachmentReceiptV2(
  options: ConstructRenewalScheduleAttachmentReceiptV2Options,
): Promise<RenewalScheduleAttachmentReceiptV2> {
  const args = captureAttachmentReceipt(options);
  const prepared = await prepareRenewalPriceReplacementV2({
    ...args.attachRequest.preparation,
    expected: args.attachRequest.preparation
      .expected as PrepareRenewalPriceReplacementOptions["expected"],
  });
  const request = await prepareRenewalScheduleAttachmentV2({
    prepared,
    apiVersion: args.attachRequest.apiVersion,
    attachKey: args.attachRequest.attachKey,
    firstDispatchedAt: args.attachRequest.firstDispatchedAt,
  });
  const { scope, apiVersion, method, path, payload, key, firstDispatchedAt } =
    request;
  if (
    !equal(args.actualDispatch, {
      scope,
      apiVersion,
      method,
      path,
      payload,
      key,
      firstDispatchedAt,
    })
  )
    throw Error(
      "Renewal attachment dispatch does not match its complete request.",
    );
  const billingCustomer = prepared.providerSnapshot.billingCustomer;
  if (!billingCustomer)
    throw Error("Renewal attachment requires its retained billing Customer.");
  const scheduleId = resourceId("sub_sched").parse(args.providerSnapshot.id);
  assertAttachmentIdentity(args.providerSnapshot, {
    scheduleId,
    subscriptionId: prepared.expected.subscriptionId,
    billingCustomerId: billingCustomer.id,
    customerAccountId: prepared.expected.customerAccountId,
    livemode: prepared.expected.livemode,
  });
  const receipt = {
    version: 2 as const,
    stage: "attached_unconfigured" as const,
    scope: "platform" as const,
    logicalBinding: prepared.requestIdentity.binding,
    request,
    scheduleId,
    subscriptionId: prepared.expected.subscriptionId,
    customerAccountId: prepared.expected.customerAccountId,
    livemode: prepared.expected.livemode,
    providerSnapshot: args.providerSnapshot,
  };
  return {
    ...receipt,
    binding: await renewalBindingV2("renewal-attach-receipt", receipt),
  };
}

export type ProjectRenewalConfigurationV2Options = {
  preparation: PrepareRenewalPriceReplacementV2Options;
  /** Raw attachment inputs, not a stored receipt or caller verification handle. */
  attachReceipt: ConstructRenewalScheduleAttachmentReceiptV2Options;
  freshSubscription: unknown;
  targetPrice: unknown;
  billingCustomer?: unknown;
  schedule: unknown;
  apiVersion: string;
  observedAt: number;
  firstDispatchedAt: number;
  configureKey: string;
};
export type ProjectedRenewalConfigurationV2 = Omit<
  ProjectedRenewalConfiguration,
  "version"
> & { version: 2 };
export type RenewalConfigurationProjectionFailure = Failure;

/** Pure raw-only configuration candidate; provider qualification remains required. */
export async function projectRenewalConfigurationV2(
  options: ProjectRenewalConfigurationV2Options,
): Promise<
  ProjectedRenewalConfigurationV2 | RenewalConfigurationProjectionFailure
> {
  const args = captureConfiguration(options);
  let ownedScheduleId: string | undefined;
  try {
    if (!equal(args.preparation, args.attachReceipt.attachRequest.preparation))
      conflict("invalid_prepared_binding");
    let prepared: PreparedRenewalPriceReplacementV2;
    try {
      prepared = await prepareRenewalPriceReplacementV2({
        ...args.preparation,
        expected: args.preparation
          .expected as PrepareRenewalPriceReplacementOptions["expected"],
      });
    } catch {
      conflict("invalid_prepared_binding");
    }
    let receipt: RenewalScheduleAttachmentReceiptV2;
    try {
      receipt = await constructRenewalScheduleAttachmentReceiptV2(
        args.attachReceipt as ConstructRenewalScheduleAttachmentReceiptV2Options,
      );
    } catch {
      conflict("invalid_attach_receipt_binding");
    }
    if (
      receipt.logicalBinding !== prepared.requestIdentity.binding ||
      receipt.request.logicalBinding !== prepared.requestIdentity.binding ||
      receipt.request.apiVersion !== args.apiVersion ||
      receipt.request.payload.from_subscription !==
        prepared.expected.subscriptionId ||
      receipt.subscriptionId !== prepared.expected.subscriptionId ||
      receipt.customerAccountId !== prepared.expected.customerAccountId ||
      receipt.livemode !== prepared.expected.livemode ||
      receipt.request.firstDispatchedAt > args.observedAt
    )
      conflict("invalid_attach_receipt_binding");
    ownedScheduleId = receipt.scheduleId;
    const key = validateConfigureStart(args, receipt);
    const reads = validateReadMaterial(args, prepared, receipt.scheduleId);
    const { schedule, payload } = configureMaterial(
      // Unlike V1's record parser, retain every own key of the captured body.
      z
        .custom<Record<string, unknown>>(
          (value) =>
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value),
        )
        .parse(args.schedule),
      prepared,
      receipt,
      reads,
    );
    const request = {
      version: 2 as const,
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
      baselineBinding: await renewalBindingV2(
        "renewal-baseline",
        receipt.providerSnapshot,
      ),
      defaultSettingsBinding: await renewalBindingV2(
        "renewal-defaults",
        schedule.default_settings,
      ),
    };
    return renewalSnapshot({
      ...request,
      status: "projected_configure_request" as const,
      providerQualification: "required" as const,
      profile: reads.profile,
      requestIdentity: {
        key,
        binding: await renewalBindingV2("renewal-configure", request),
      },
    });
  } catch (error) {
    return failure(error, ownedScheduleId);
  }
}
