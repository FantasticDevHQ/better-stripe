import { defineTable } from "convex/server";
import { v } from "convex/values";
import { scopeFields, claimDoc } from "../costRecovery/schema.js";
export const source = v.union(
  v.object({
    kind: v.literal("sale"),
    paymentIntentId: v.string(),
    gross: v.number(),
    customerAccountId: v.string(),
    invoiceId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    stripeAccountId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("invoice_recovery"),
    paymentIntentId: v.string(),
    gross: v.number(),
    groupKey: v.string(),
  }),
);
export const policy = v.object({
  sellingFee: v.number(),
  liability: v.object({
    processingCosts: v.union(
      v.literal("uncovered"),
      v.literal("all"),
      v.literal("none"),
    ),
    disputeCosts: v.union(v.literal("all"), v.literal("none")),
  }),
  rounding: v.union(
    v.literal("nearest"),
    v.literal("floor"),
    v.literal("ceil"),
  ),
});
export const provenance = v.object({
  invoiceId: v.string(),
  invoicePaymentId: v.string(),
  recoveryInvoiceItemId: v.optional(v.string()),
  customerAccountId: v.string(),
  subscriptionId: v.optional(v.string()),
  stripePriceId: v.optional(v.string()),
  stripeProductId: v.optional(v.string()),
});
export const observation = v.object({
  paymentIntentId: v.string(),
  sourceChargeId: v.string(),
  currency: v.string(),
  gross: v.number(),
  originalProcessingFee: v.number(),
  processingFee: v.number(),
  disputeFees: v.number(),
  principalReturned: v.number(),
  provenance,
});
export const deficit = v.object({
  currency: v.string(),
  retainedFee: v.number(),
  processingLiability: v.number(),
  disputeLiability: v.number(),
  amountDue: v.number(),
});
export const result = v.object({
  claim: claimDoc,
  rollbackClaim: v.optional(claimDoc),
  deficit,
  observation,
});
export const failure = v.union(
  v.object({
    status: v.literal("not_ready"),
    reason: v.union(
      v.literal("provider_pending"),
      v.literal("fee_pending"),
      v.literal("history_incomplete"),
    ),
    retryable: v.literal(true),
  }),
  v.object({
    status: v.literal("conflict"),
    reason: v.union(
      v.literal("scope_busy"),
      v.literal("revision_changed"),
      v.literal("identity_changed"),
    ),
    retryable: v.literal(false),
  }),
  v.object({
    status: v.literal("rejected"),
    reason: v.union(
      v.literal("invalid_scope"),
      v.literal("unsupported_source"),
      v.literal("policy_invalid"),
      v.literal("payment_not_payable"),
      v.literal("currency_mismatch"),
    ),
    retryable: v.literal(false),
  }),
  v.object({
    status: v.literal("unknown"),
    reason: v.union(
      v.literal("provider_outcome_unknown"),
      v.literal("history_incomplete"),
    ),
    retryable: v.literal(false),
  }),
);
export const bindingFields = {
  ...scopeFields,
  claimKey: v.string(),
  source,
  policy,
  expectedRevision: v.number(),
  rollback: v.optional(
    v.object({ groupKey: v.string(), expectedRevision: v.number() }),
  ),
  provider: v.string(),
  projection: v.optional(v.string()),
  importHook: v.optional(v.string()),
  providerApiVersion: v.string(),
  definitionVersion: v.number(),
  maxAttempts: v.number(),
  retryDelayMs: v.number(),
};
export const startFields = { ...bindingFields, requestKey: v.string() };
export const operationFields = {
  ...startFields,
  version: v.number(),
  workflowId: v.optional(v.string()),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("waiting"),
    v.literal("completed"),
    v.literal("conflict"),
    v.literal("rejected"),
    v.literal("unknown"),
  ),
  failure: v.optional(failure),
  result: v.optional(result),
};
export const operationsTable = defineTable(operationFields)
  .index("by_request", ["requestKey"])
  .index("by_claim_status", ["claimKey", "status"])
  .index("by_payment_scope", [
    "accountId",
    "scopeKey",
    "currency",
    "source.paymentIntentId",
  ]);
export const refFields = {
  ...scopeFields,
  operationId: v.id("processingCostReconciliationOperations"),
  version: v.number(),
};
export const operationDoc = v.object({
  ...operationFields,
  _id: v.id("processingCostReconciliationOperations"),
  _creationTime: v.number(),
});
const publicFailureFields = {
  ...refFields,
  status: v.union(
    v.literal("not_ready"),
    v.literal("conflict"),
    v.literal("rejected"),
    v.literal("unknown"),
  ),
  reason: v.string(),
  retryable: v.boolean(),
};
export const safeStatus = v.union(
  v.object({
    ...refFields,
    status: v.union(v.literal("queued"), v.literal("running")),
  }),
  v.object({ ...refFields, status: v.literal("completed"), result }),
  v.object(publicFailureFields),
);
export const importSnapshot = v.union(
  v.null(),
  v.object({
    operationKey: v.string(),
    amountDue: v.number(),
    collectedAmount: v.number(),
    revision: v.number(),
  }),
);
