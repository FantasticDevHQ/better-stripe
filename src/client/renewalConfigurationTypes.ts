import type {
  AttachRenewalScheduleOptions,
  AttachRenewalScheduleResult,
  RenewalAttachmentAuthorization,
} from "./renewalAttachmentTypes.js";
import type { FunctionReference } from "convex/server";
import type { RenewalConfigurationReceiptV2 } from "./billing/renewalV2/index.js";
export type RenewalConfigurationAuthorization = Omit<
  RenewalAttachmentAuthorization,
  "capability"
> & { capability: "renewal_configuration_v1"; attachmentOperationId: string };
export type ConfigureRenewalScheduleOptions = Omit<
  AttachRenewalScheduleOptions,
  "authorizationQuery"
> & {
  authorizationQuery: FunctionReference<
    "query",
    "public" | "internal",
    RenewalConfigurationAuthorization,
    boolean
  >;
};
export type ConfigureRenewalScheduleResult =
  | Exclude<AttachRenewalScheduleResult, { status: "attached_incomplete" }>
  | {
      status: "configure_acknowledged";
      operationId: string;
      attemptId: string;
      receipt: RenewalConfigurationReceiptV2;
    };
