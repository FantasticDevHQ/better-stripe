import { v } from "convex/values";
export const operationReference = v.object({
  accountId: v.string(),
  scopeKey: v.string(),
  operationId: v.string(),
  version: v.number(),
  kind: v.union(v.literal("prepare"), v.literal("apply")),
});
export const requestFields = {
  sellerId: v.id("users"),
  accountId: v.string(),
  scopeKey: v.string(),
  subscriptionId: v.string(),
  enabled: v.boolean(),
  consentAt: v.number(),
  observationEpoch: v.optional(v.number()),
  state: v.union(
    v.literal("pending"),
    v.literal("held"),
    v.literal("finished"),
  ),
  operation: v.optional(operationReference),
};
export const requestDoc = v.object({
  ...requestFields,
  _id: v.id("storeBalanceRequests"),
  _creationTime: v.number(),
});
export const phaseFields = {
  accountId: v.string(),
  scopeKey: v.string(),
  operationId: v.string(),
  version: v.number(),
  stripeSubscriptionId: v.string(),
  providerApiVersion: v.string(),
  definitionVersion: v.string(),
  phase: v.union(v.literal("create"), v.literal("attach"), v.literal("apply")),
  providerKey: v.string(),
};
export const providerResult = v.union(
  v.object({
    status: v.literal("ready"),
    value: v.object({
      phase: phaseFields.phase,
      customerAccount: v.string(),
      stripeSubscriptionId: v.string(),
      providerApiVersion: v.string(),
      paymentMethodId: v.union(v.string(), v.null()),
      paymentMethodTypes: v.optional(v.union(v.array(v.string()), v.null())),
      enabled: v.optional(v.boolean()),
    }),
  }),
  v.object({
    status: v.literal("unknown"),
    reason: v.union(
      v.literal("provider_outcome_unknown"),
      v.literal("history_incomplete"),
    ),
    retryable: v.literal(false),
  }),
  v.object({
    status: v.literal("conflict"),
    reason: v.union(
      v.literal("identity_changed"),
      v.literal("revision_changed"),
      v.literal("scope_busy"),
    ),
    retryable: v.literal(false),
  }),
  v.object({
    status: v.literal("rejected"),
    reason: v.union(
      v.literal("policy_invalid"),
      v.literal("unsupported_source"),
      v.literal("invalid_scope"),
    ),
    retryable: v.literal(false),
  }),
  v.object({
    status: v.literal("not_ready"),
    reason: v.literal("provider_pending"),
    retryable: v.literal(true),
  }),
);
