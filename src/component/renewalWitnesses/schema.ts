import { defineTable } from "convex/server";
import { v } from "convex/values";

export const identity = v.object({
  componentScope: v.string(),
  witnessId: v.string(),
  parentOperationId: v.id("renewalOperations"),
  operationId: v.id("renewalOperations"),
});
export const descriptor = v.object({
  version: v.literal(1),
  witnessRowId: v.id("renewalObservationWitnesses"),
  identity,
  payloadBinding: v.string(),
  capturedSubject: v.string(),
  observedAtMs: v.number(),
  customerAccountId: v.string(),
  customerId: v.string(),
  livemode: v.boolean(),
  subscriptionId: v.string(),
  scheduleId: v.string(),
  observedItemId: v.string(),
  nativePeriod: v.object({ start: v.number(), end: v.number() }),
  operationalAuthority: v.literal(false),
  authenticationEstablished: v.literal(false),
  publicDeliveryEstablished: v.literal(false),
  providerQualificationRequired: v.literal(true),
});
export const witnessesTable = defineTable({
  identity,
  payloadJSON: v.string(),
  payloadBinding: v.string(),
}).index("by_componentScope_and_witnessId", [
  "identity.componentScope",
  "identity.witnessId",
]);
