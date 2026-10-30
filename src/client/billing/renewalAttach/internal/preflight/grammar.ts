import { closed } from "../material/nodeKernel.js";
import type { AttachRaw, Bundle } from "../material/capture.js";
import type {
  ProjectRenewalConfigurationV2Options,
  ProjectedRenewalConfigurationV2,
  RenewalScheduleAttachmentReceiptV2,
} from "../../../renewalV2/index.js";
export type Data = Record<string, unknown>;
export type Configuration = ProjectRenewalConfigurationV2Options & {
  preparation: AttachRaw["preparation"];
  attachReceipt: ProjectRenewalConfigurationV2Options["attachReceipt"] & {
    attachRequest: AttachRaw;
  };
  freshSubscription: Bundle["wireSubscription"];
};
/** Detached consistency data, never a Source, dispatch, ownership or acknowledgement capability. */
export interface PreflightRecord {
  configuration: Configuration;
  request: ProjectedRenewalConfigurationV2;
  attachReceipt: RenewalScheduleAttachmentReceiptV2;
  originalBundle: Bundle;
}
export interface CurrentEvidence {
  bundle: Bundle;
  schedule: Data;
  observedAt: number;
}
export interface PreflightOutput {
  status: "configure_preflight_consistent";
  originalRecord: PreflightRecord;
  currentEvidence: CurrentEvidence;
  request: ProjectedRenewalConfigurationV2;
  operationalAuthority: false;
}
export const recordFamilies: Readonly<Record<string, string>> = Object.freeze({
  "/request/logicalBinding": "renewal",
  "/request/attachReceiptBinding": "renewal-attach-receipt",
  "/request/baselineBinding": "renewal-baseline",
  "/request/defaultSettingsBinding": "renewal-defaults",
  "/request/requestIdentity/binding": "renewal-configure",
  "/attachReceipt/logicalBinding": "renewal",
  "/attachReceipt/request/logicalBinding": "renewal",
  "/attachReceipt/request/requestIdentity/binding": "renewal-attach",
  "/attachReceipt/binding": "renewal-attach-receipt",
});
export const outputFamilies: Readonly<Record<string, string>> = Object.freeze({
  "/originalRecord/request/logicalBinding": "renewal",
  "/originalRecord/request/attachReceiptBinding": "renewal-attach-receipt",
  "/originalRecord/request/baselineBinding": "renewal-baseline",
  "/originalRecord/request/defaultSettingsBinding": "renewal-defaults",
  "/originalRecord/request/requestIdentity/binding": "renewal-configure",
  "/request/logicalBinding": "renewal",
  "/request/attachReceiptBinding": "renewal-attach-receipt",
  "/request/baselineBinding": "renewal-baseline",
  "/request/defaultSettingsBinding": "renewal-defaults",
  "/request/requestIdentity/binding": "renewal-configure",
  "/originalRecord/attachReceipt/logicalBinding": "renewal",
  "/originalRecord/attachReceipt/request/logicalBinding": "renewal",
  "/originalRecord/attachReceipt/request/requestIdentity/binding":
    "renewal-attach",
  "/originalRecord/attachReceipt/binding": "renewal-attach-receipt",
});
const schema = {
  success: {
    root: {
      required: [
        "status",
        "originalRecord",
        "currentEvidence",
        "request",
        "operationalAuthority",
      ],
    },
    originalRecord: {
      required: ["configuration", "request", "attachReceipt", "originalBundle"],
    },
    currentEvidence: {
      required: ["bundle", "schedule", "observedAt"],
    },
  },
  rawConfigurationCapture: {
    required: [
      "preparation",
      "attachReceipt",
      "freshSubscription",
      "targetPrice",
      "schedule",
      "apiVersion",
      "observedAt",
      "firstDispatchedAt",
      "configureKey",
    ],
    optional: ["billingCustomer"],
    preparationRequired: ["subscription", "targetPrice", "expected", "key"],
    preparationOptional: ["billingCustomer"],
    rawAttachReceiptRequired: [
      "attachRequest",
      "actualDispatch",
      "providerSnapshot",
    ],
    rawAttachRequestRequired: [
      "preparation",
      "apiVersion",
      "attachKey",
      "firstDispatchedAt",
    ],
    rawActualDispatchRequired: [
      "scope",
      "apiVersion",
      "method",
      "path",
      "payload",
      "key",
      "firstDispatchedAt",
    ],
  },
  closedControlSchemas: {
    "originalRecord/request": [
      "version",
      "stage",
      "scope",
      "apiVersion",
      "logicalBinding",
      "scheduleId",
      "method",
      "path",
      "key",
      "payload",
      "firstDispatchedAt",
      "attachReceiptBinding",
      "baselineBinding",
      "defaultSettingsBinding",
      "status",
      "providerQualification",
      "profile",
      "requestIdentity",
    ],
    request: [
      "version",
      "stage",
      "scope",
      "apiVersion",
      "logicalBinding",
      "scheduleId",
      "method",
      "path",
      "key",
      "payload",
      "firstDispatchedAt",
      "attachReceiptBinding",
      "baselineBinding",
      "defaultSettingsBinding",
      "status",
      "providerQualification",
      "profile",
      "requestIdentity",
    ],
    "originalRecord/attachReceipt": [
      "version",
      "stage",
      "scope",
      "logicalBinding",
      "request",
      "scheduleId",
      "subscriptionId",
      "customerAccountId",
      "livemode",
      "providerSnapshot",
      "binding",
    ],
    "originalRecord/attachReceipt/request": [
      "version",
      "stage",
      "scope",
      "apiVersion",
      "logicalBinding",
      "method",
      "path",
      "payload",
      "key",
      "firstDispatchedAt",
      "requestIdentity",
    ],
    "request/requestIdentity": ["key", "binding"],
    "originalRecord/request/requestIdentity": ["key", "binding"],
    "originalRecord/attachReceipt/request/requestIdentity": ["key", "binding"],
    "originalRecord/originalBundle": [
      "wireSubscription",
      "wireTargetPrice",
      "wireBillingCustomer",
      "couponReads",
      "derivedCouponJoins",
    ],
    "currentEvidence/bundle": [
      "wireSubscription",
      "wireTargetPrice",
      "wireBillingCustomer",
      "couponReads",
      "derivedCouponJoins",
    ],
    "eachBundle/derivedCouponJoins": ["subscription", "item"],
    "eachBundle/couponReads/row": ["couponId", "wireCoupon", "association"],
    "eachBundle/couponReads/row/association": ["resource", "ordinal"],
    "eachBundle/derivedCouponJoins/eachRow": [
      "index",
      "discountId",
      "originalCouponReference",
      "couponReadIndex",
      "joinedDiscount",
    ],
    "eachProjectedRequest/profile": [
      "apiVersion",
      "billingMode",
      "cadence",
      "anchor",
    ],
  },
};
export function controls(x: unknown, path: string, output: boolean): void {
  const prefix = output ? "/originalRecord" : "";
  if (path === (output ? "/originalRecord" : ""))
    closed(x, schema.success.originalRecord.required);
  if (output && path === "") closed(x, schema.success.root.required);
  if (output && path === "/currentEvidence")
    closed(x, schema.success.currentEvidence.required);
  if (path === prefix + "/configuration")
    closed(
      x,
      schema.rawConfigurationCapture.required,
      schema.rawConfigurationCapture.optional,
    );
  if (
    path === prefix + "/configuration/preparation" ||
    path === prefix + "/configuration/attachReceipt/attachRequest/preparation"
  )
    closed(
      x,
      schema.rawConfigurationCapture.preparationRequired,
      schema.rawConfigurationCapture.preparationOptional,
    );
  if (path === prefix + "/configuration/attachReceipt")
    closed(x, schema.rawConfigurationCapture.rawAttachReceiptRequired);
  if (path === prefix + "/configuration/attachReceipt/attachRequest")
    closed(x, schema.rawConfigurationCapture.rawAttachRequestRequired);
  if (path === prefix + "/configuration/attachReceipt/actualDispatch")
    closed(x, schema.rawConfigurationCapture.rawActualDispatchRequired);
  const relative = output ? path.replace(/^\//, "") : "originalRecord" + path;
  if (
    Object.prototype.hasOwnProperty.call(schema.closedControlSchemas, relative)
  )
    closed(
      x,
      (schema.closedControlSchemas as Record<string, readonly string[]>)[
        relative
      ]!,
    );
}
