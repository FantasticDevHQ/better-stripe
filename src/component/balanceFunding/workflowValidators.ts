import { v, type Infer } from "convex/values";
import { operationRefFields, operationRef } from "./schema.js";
import {
  providerPhase,
  provisioningReceipt,
  workflowUnavailable,
} from "./workflowSchema.js";
export const workflowRefFields = {
  ...operationRefFields,
  stripeSubscriptionId: v.string(),
  providerApiVersion: v.string(),
  definitionVersion: v.string(),
};
export const workflowRef = v.object(workflowRefFields);
export type FundingWorkflowRef = Infer<typeof workflowRef>;
export const phaseRefFields = {
  ...workflowRefFields,
  phase: providerPhase,
  providerKey: v.string(),
};
export const phaseRef = v.object(phaseRefFields);
export type FundingPhaseRef = Infer<typeof phaseRef>;
export const workflowStartResult = v.union(
  v.object({
    status: v.literal("accepted"),
    operation: operationRef,
    workflowId: v.optional(v.string()),
  }),
  v.object({ status: v.literal("canceled"), operation: operationRef }),
  workflowUnavailable,
);
export const phaseClaimResult = v.union(
  v.object({
    status: v.literal("claimed"),
    mode: v.union(v.literal("execute"), v.literal("reconcile")),
    paymentMethodId: v.optional(v.string()),
  }),
  v.object({ status: v.literal("ready"), value: provisioningReceipt }),
  workflowUnavailable,
);
