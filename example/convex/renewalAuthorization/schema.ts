import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  operationFields,
  providerScope,
  storedPermission,
  storedInvoicePermission,
  witnessScope,
  storedReadPermission,
} from "./validators";

/** Trusted host permission records, never authorization inferred from journal DATA. */
export const renewalAuthorizationTables = {
  renewalOperationGrants: defineTable({
    userId: v.id("users"),
    tokenIdentifier: v.string(),
    ...operationFields,
    providerScope,
    observation: v.union(v.null(), storedPermission),
    invoice: v.union(v.null(), storedInvoicePermission),
  }).index("by_user_and_operation", [
    "userId",
    "componentScope",
    "parentOperationId",
    "operationId",
  ]),
  renewalWitnessGrants: defineTable({
    userId: v.id("users"),
    tokenIdentifier: v.string(),
    componentScope: v.string(),
    witnessId: v.string(),
    scope: witnessScope,
    retain: v.union(v.null(), storedPermission),
    read: v.union(v.null(), storedReadPermission),
  }).index("by_user_and_witness", ["userId", "componentScope", "witnessId"]),
};
