import { defineTable } from "convex/server";
import { v } from "convex/values";
export const scopeFields = {
  accountId: v.string(),
  scopeKey: v.string(),
  currency: v.string(),
};
export const totalsFields = {
  amountDue: v.number(),
  collectedAmount: v.number(),
  reservedAmount: v.number(),
  outstanding: v.number(),
};
export const signValidator = v.union(
  v.literal("positive"),
  v.literal("negative"),
  v.literal("zero"),
);
export const observationFields = {
  ...scopeFields,
  claimKey: v.string(),
  sourceChargeId: v.string(),
  sourceGross: v.number(),
  sourceProcessingFee: v.number(),
  amountDue: v.number(),
  revision: v.number(),
};
export const claimFields = {
  ...observationFields,
  collectedAmount: v.number(),
  reservedAmount: v.number(),
  outstanding: v.number(),
  sign: signValidator,
};
export const claimDoc = v.object({
  ...claimFields,
  _id: v.id("recoveryClaims"),
  _creationTime: v.number(),
});
export const balanceFields = {
  ...scopeFields,
  ...totalsFields,
  activeGroupKey: v.optional(v.string()),
};
export const groupInput = {
  ...scopeFields,
  groupKey: v.string(),
  sourceKind: v.union(v.literal("settlement"), v.literal("invoice")),
  sourceId: v.string(),
  sourceGross: v.optional(v.number()),
  sourceProcessingFee: v.optional(v.number()),
  maxDebit: v.number(),
  maxCredit: v.number(),
};
export const groupFields = {
  ...groupInput,
  amount: v.number(),
  pendingOperations: v.number(),
  status: v.union(
    v.literal("open"),
    v.literal("sealed"),
    v.literal("collecting"),
    v.literal("releasing"),
    v.literal("collected"),
    v.literal("released"),
  ),
};
export const groupDoc = v.object({
  ...groupFields,
  _id: v.id("recoveryGroups"),
  _creationTime: v.number(),
});
export const reservationFields = {
  operationKey: v.string(),
  groupKey: v.string(),
  amount: v.number(),
  limit: v.number(),
  allocations: v.array(
    v.object({
      claimId: v.id("recoveryClaims"),
      claimKey: v.string(),
      amount: v.number(),
    }),
  ),
  status: v.union(
    v.literal("reserved"),
    v.literal("collected"),
    v.literal("released"),
    v.literal("empty"),
  ),
};
export const reservationDoc = v.object({
  ...reservationFields,
  _id: v.id("recoveryReservations"),
  _creationTime: v.number(),
});
export const claimsTable = defineTable(claimFields)
  .index("by_key", ["claimKey"])
  .index("by_scope", ["accountId", "scopeKey", "currency"])
  .index("by_sign", ["accountId", "scopeKey", "currency", "sign"]);
export const balancesTable = defineTable(balanceFields).index("by_scope", [
  "accountId",
  "scopeKey",
  "currency",
]);
export const groupsTable = defineTable(groupFields).index("by_key", [
  "groupKey",
]);
export const reservationsTable = defineTable(reservationFields)
  .index("by_key", ["operationKey"])
  .index("by_group_status", ["groupKey", "status"]);

export const reserveArgs = {
  ...groupInput,
  operationKey: v.string(),
  limit: v.optional(v.number()),
};
export const finishArgs = {
  groupKey: v.string(),
  outcome: v.union(v.literal("collect"), v.literal("release")),
  limit: v.optional(v.number()),
};
export const rollbackArgs = {
  groupKey: v.string(),
  returnedPrincipal: v.number(),
  revision: v.number(),
};
