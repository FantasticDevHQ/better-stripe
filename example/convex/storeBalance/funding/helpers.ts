import { v } from "convex/values";

export const fields = {
  sellerId: v.id("users"),
  subscriptionId: v.string(),
  enabled: v.boolean(),
  paymentMethodId: v.string(),
  previousPaymentMethodId: v.optional(v.string()),
  previousPaymentMethodTypes: v.optional(v.array(v.string())),
  consentAt: v.number(),
  operationVersion: v.optional(v.number()),
  operationPending: v.optional(v.boolean()),
  targetEnabled: v.optional(v.boolean()),
};

export const migrationLink = v.object({
  accountId: v.string(),
  scopeKey: v.string(),
  preparationId: v.string(),
  snapshot: v.string(),
  state: v.union(
    v.literal("imported"),
    v.literal("active"),
    v.literal("rolled_back"),
  ),
  operation: v.optional(
    v.object({
      accountId: v.string(),
      scopeKey: v.string(),
      operationId: v.string(),
      version: v.number(),
    }),
  ),
});

export const quiescence = v.object({
  snapshot: v.string(),
  reference: v.string(),
  confirmedAt: v.number(),
});
export const doc = v.object({
  ...fields,
  migrationPaused: v.optional(v.boolean()),
  legacyQuiescence: v.optional(quiescence),
  componentMigration: v.optional(migrationLink),
  _id: v.id("storeBalanceFunding"),
  _creationTime: v.number(),
});
