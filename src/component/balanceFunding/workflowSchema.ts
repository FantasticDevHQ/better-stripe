import { v, type Infer } from "convex/values";
export const FUNDING_WORKFLOW_VERSION = "balance-funding/v1";
export const providerPhase = v.union(
  v.literal("create"),
  v.literal("attach"),
  v.literal("apply"),
);
export type ProviderPhase = Infer<typeof providerPhase>;
export const provisioningReceipt = v.object({
  phase: providerPhase,
  customerAccount: v.string(),
  stripeSubscriptionId: v.string(),
  paymentMethodId: v.union(v.string(), v.null()),
  paymentMethodTypes: v.optional(v.union(v.array(v.string()), v.null())),
  enabled: v.optional(v.boolean()),
  providerApiVersion: v.string(),
});
export type ProvisioningReceipt = Infer<typeof provisioningReceipt>;
const phaseState = v.object({
  state: v.union(
    v.literal("running"),
    v.literal("unknown"),
    v.literal("succeeded"),
  ),
  receipt: v.optional(provisioningReceipt),
});
export const workflowBinding = v.object({
  workflowId: v.optional(v.string()),
  definitionVersion: v.string(),
  providerApiVersion: v.string(),
  providerAction: v.string(),
  create: v.optional(phaseState),
  attach: v.optional(phaseState),
  apply: v.optional(phaseState),
});
export const providerUnknown = v.object({
  status: v.literal("unknown"),
  reason: v.union(
    v.literal("provider_outcome_unknown"),
    v.literal("history_incomplete"),
  ),
  retryable: v.literal(false),
});
export const providerConflict = v.object({
  status: v.literal("conflict"),
  reason: v.union(
    v.literal("scope_busy"),
    v.literal("identity_changed"),
    v.literal("revision_changed"),
  ),
  retryable: v.literal(false),
});
export const providerRejected = v.object({
  status: v.literal("rejected"),
  reason: v.union(
    v.literal("invalid_scope"),
    v.literal("unsupported_source"),
    v.literal("policy_invalid"),
  ),
  retryable: v.literal(false),
});
export const providerNotReady = v.object({
  status: v.literal("not_ready"),
  reason: v.literal("provider_pending"),
  retryable: v.literal(true),
});
export const workflowUnavailable = v.union(
  providerUnknown,
  providerConflict,
  providerRejected,
  providerNotReady,
);
export type WorkflowUnavailable = Infer<typeof workflowUnavailable>;
export const providerResult = v.union(
  v.object({ status: v.literal("ready"), value: provisioningReceipt }),
  workflowUnavailable,
);
export type ProviderResult = Infer<typeof providerResult>;
