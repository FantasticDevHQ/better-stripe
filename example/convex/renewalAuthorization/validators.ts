import { v } from "convex/values";

export const operationFields = {
  componentScope: v.string(),
  parentOperationId: v.string(),
  operationId: v.string(),
};
export const baseProviderFields = {
  mode: v.literal("platform"),
  stripeAccount: v.null(),
  livemode: v.boolean(),
  customerAccountId: v.string(),
  subscriptionId: v.string(),
  scheduleId: v.string(),
};
export const providerScope = v.object({
  ...baseProviderFields,
  customerId: v.string(),
});
export const metadataFields = {
  authorizationId: v.string(),
  authorizationRevision: v.number(),
  expiresAtMs: v.number(),
};
export const storedPermission = v.object({
  ...metadataFields,
  revoked: v.boolean(),
});
export const observationSnapshot = v.object({
  ...operationFields,
  providerScope: v.object(baseProviderFields),
  tokenIdentifier: v.string(),
  ...metadataFields,
});
export const invoiceFields = {
  capability: v.literal("renewal_invoice_evidence_v1"),
  ...operationFields,
  providerScope,
  originalInvoiceId: v.string(),
  currentInvoiceId: v.string(),
};
export const invoiceSnapshot = v.object({
  ...invoiceFields,
  tokenIdentifier: v.string(),
  ...metadataFields,
});
export const storedInvoicePermission = v.object({
  ...metadataFields,
  revoked: v.boolean(),
  originalInvoiceId: v.string(),
  currentInvoiceId: v.string(),
});
export const witnessIdentity = v.object({
  ...operationFields,
  witnessId: v.string(),
});
export const witnessScope = v.object({
  identity: witnessIdentity,
  providerScope,
  configureRequestBinding: v.string(),
  observedItemId: v.string(),
  nativePeriod: v.object({ start: v.number(), end: v.number() }),
});
export const retainFields = {
  capability: v.literal("renewal_witness_retain_v1"),
  scope: witnessScope,
};
export const readFields = {
  capability: v.literal("renewal_witness_read_v1"),
  identity: witnessIdentity,
};
const witnessSnapshotFields = {
  scope: witnessScope,
  tokenIdentifier: v.string(),
  ...metadataFields,
};
export const retainSnapshot = v.object({
  capability: v.literal("renewal_witness_retain_v1"),
  ...witnessSnapshotFields,
});
export const readSnapshot = v.object({
  capability: v.literal("renewal_witness_read_v1"),
  ...witnessSnapshotFields,
  witnessRowId: v.string(),
  payloadBinding: v.string(),
});
export const storedReadPermission = v.object({
  ...metadataFields,
  revoked: v.boolean(),
  witnessRowId: v.string(),
  payloadBinding: v.string(),
});
