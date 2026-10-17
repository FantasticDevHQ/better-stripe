import { defineTable } from "convex/server";
import { v } from "convex/values";
import { workflowBinding } from "./workflowSchema.js";
export const scopeFields = { accountId: v.string(), scopeKey: v.string() };
export const originalFields = {
  customerAccount: v.string(),
  stripeSubscriptionId: v.string(),
  previousPaymentMethodId: v.union(v.string(), v.null()),
  previousPaymentMethodTypes: v.union(v.array(v.string()), v.null()),
};
export const originalValue = v.object(originalFields);
export const capturedValue = v.object({
  ...originalFields,
  paymentMethodId: v.optional(v.string()),
});
export const preparationValue = v.object({
  ...originalFields,
  paymentMethodId: v.string(),
});
export const receiptValue = v.object({
  customerAccount: v.string(),
  stripeSubscriptionId: v.string(),
  paymentMethodId: v.union(v.string(), v.null()),
  paymentMethodTypes: v.union(v.array(v.string()), v.null()),
  providerApiVersion: v.string(),
});
export const preparationFields = {
  ...scopeFields,
  preparation: capturedValue,
  consentAt: v.number(),
  consentReference: v.string(),
  providerApiVersion: v.string(),
  enabled: v.boolean(),
  startsPaused: v.boolean(),
  verified: v.boolean(),
  preparationOperationId: v.optional(v.id("balanceFundingOperations")),
  operationVersion: v.number(),
  activeOperationId: v.optional(v.id("balanceFundingOperations")),
};
export const preparationDoc = v.object({
  ...preparationFields,
  _id: v.id("balanceFundingPreparations"),
  _creationTime: v.number(),
});
export const operationRefFields = {
  ...scopeFields,
  operationId: v.id("balanceFundingOperations"),
  version: v.number(),
};
export const operationRef = v.object(operationRefFields);
export const providerKeys = v.object({
  enable: v.string(),
  disable: v.string(),
  create: v.optional(v.string()),
  attach: v.optional(v.string()),
});
export const failureCode = v.union(
  v.literal("invalid_scope"),
  v.literal("unsupported_source"),
  v.literal("policy_invalid"),
);
export const operationFields = {
  ...scopeFields,
  preparationId: v.id("balanceFundingPreparations"),
  version: v.number(),
  enabled: v.boolean(),
  kind: v.union(v.literal("prepare"), v.literal("apply")),
  providerKey: v.string(),
  state: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("unknown"),
    v.literal("succeeded"),
    v.literal("canceled"),
    v.literal("failed"),
  ),
  cancelRequested: v.boolean(),
  failureCode: v.optional(failureCode),
  providerKeys,
  receipt: v.optional(receiptValue),
  execution: v.optional(workflowBinding),
};
export const operationDoc = v.object({
  ...operationFields,
  _id: v.id("balanceFundingOperations"),
  _creationTime: v.number(),
});
export const conflict = v.object({
  status: v.literal("conflict"),
  reason: v.union(
    v.literal("scope_busy"),
    v.literal("identity_changed"),
    v.literal("revision_changed"),
  ),
  retryable: v.literal(false),
});
export const rejected = v.object({
  status: v.literal("rejected"),
  reason: v.literal("policy_invalid"),
  retryable: v.literal(false),
});
export const beginResult = v.union(
  v.object({ status: v.literal("accepted"), operation: operationRef }),
  v.object({ status: v.literal("unchanged"), enabled: v.boolean() }),
  conflict,
  rejected,
  v.object({
    status: v.literal("not_ready"),
    reason: v.literal("provider_pending"),
    retryable: v.literal(true),
  }),
);
export const preparationsTable = defineTable(preparationFields).index(
  "by_account_subscription",
  ["accountId", "preparation.stripeSubscriptionId"],
);
export const operationsTable = defineTable(operationFields).index(
  "by_preparation_version",
  ["preparationId", "version"],
);
export const importResult = v.object({
  preparationId: v.id("balanceFundingPreparations"),
  operation: v.optional(operationRef),
});
export const requestsTable = defineTable({
  requestKey: v.string(),
  payload: v.string(),
  preparationId: v.id("balanceFundingPreparations"),
  result: v.optional(beginResult),
  imported: v.optional(importResult),
}).index("by_request", ["requestKey"]);
export const safeStatus = v.object({
  ...operationRefFields,
  state: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("unknown"),
    v.literal("succeeded"),
    v.literal("canceled"),
    v.literal("failed"),
  ),
  cancelRequested: v.boolean(),
  failureCode: v.optional(failureCode),
});
export const invalidScope = v.object({
  status: v.literal("rejected"),
  reason: v.literal("invalid_scope"),
  retryable: v.literal(false),
});
export const preparationLookup = v.union(
  v.object({
    status: v.literal("prepared"),
    operation: operationRef,
    stripeSubscriptionId: v.string(),
    preparationId: v.id("balanceFundingPreparations"),
  }),
  v.object({
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("unknown"),
      v.literal("canceled"),
      v.literal("failed"),
    ),
    operation: operationRef,
    failureCode: v.optional(failureCode),
  }),
  conflict,
  invalidScope,
  v.null(),
);
