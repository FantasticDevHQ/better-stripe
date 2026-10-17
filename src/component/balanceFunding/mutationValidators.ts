import { v } from "convex/values";
import {
  scopeFields,
  preparationValue,
  operationRefFields,
  originalValue,
  capturedValue,
  receiptValue,
} from "./schema.js";
export const savePreparationArgs = v.object({
  ...scopeFields,
  preparation: preparationValue,
  consentAt: v.number(),
  consentReference: v.string(),
  providerApiVersion: v.string(),
});
export const beginArgs = v.object({
  ...scopeFields,
  preparationId: v.id("balanceFundingPreparations"),
  enabled: v.boolean(),
  consent: v.optional(v.literal(true)),
  requestKey: v.string(),
});
export const finishArgs = v.object({
  ...operationRefFields,
  enabled: v.boolean(),
  receipt: receiptValue,
});
export const startArgs = v.object(operationRefFields);
export const requestCancelArgs = v.object(operationRefFields);
export const markUnknownArgs = v.object(operationRefFields);
export const importPreparationArgs = v.object({
  ...scopeFields,
  sourceKey: v.string(),
  preparation: capturedValue,
  consentAt: v.number(),
  consentReference: v.string(),
  providerApiVersion: v.string(),
  enabled: v.boolean(),
  operationVersion: v.number(),
  pending: v.optional(
    v.object({
      enabled: v.boolean(),
      kind: v.optional(v.union(v.literal("prepare"), v.literal("apply"))),
      providerKey: v.string(),
      requestKey: v.string(),
    }),
  ),
});
export const prepareArgs = v.object({
  ...scopeFields,
  preparation: originalValue,
  consent: v.literal(true),
  consentAt: v.number(),
  consentReference: v.string(),
  providerApiVersion: v.string(),
  requestKey: v.string(),
});
export const finishPreparationArgs = v.object({
  ...operationRefFields,
  preparation: preparationValue,
  providerApiVersion: v.string(),
});
