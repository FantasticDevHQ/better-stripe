import type {
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import type { RenewalPriceReplacementExpected } from "./billing/renewalReplacementSchema.js";
import type { RenewalScheduleAttachmentReceiptV2 } from "./billing/renewalV2/index.js";

export type RenewalAttachmentAuthorization = {
  capability: "renewal_attachment_v1";
  operationId: string;
  authorizationScope: string;
  authorizationId: string;
  authorizationRevision: number;
  logicalOperationId: string;
  requestBinding: string;
  expected: RenewalPriceReplacementExpected;
};
export type AttachRenewalScheduleOptions = {
  operationId: string;
  requestBinding: string;
  authorizationQuery: FunctionReference<
    "query",
    "public" | "internal",
    RenewalAttachmentAuthorization,
    boolean
  >;
};
export type AttachRenewalScheduleResult =
  | {
      status: "attached_incomplete";
      operationId: string;
      attemptId: string;
      receipt: RenewalScheduleAttachmentReceiptV2;
    }
  | { status: "not_dispatched"; operationId: string; reason: string }
  | { status: "conflict"; operationId: string; reason: string }
  | {
      status: "timeout";
      outcome: "unknown";
      operationId: string;
      attemptId: string;
      reason: string;
    }
  | {
      status: "unknown";
      operationId: string;
      attemptId: string;
      reason: string;
    };
export type RenewalAttachmentActionCtx = GenericActionCtx<GenericDataModel>;
