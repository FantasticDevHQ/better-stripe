import {
  commissionTerm,
  optionalCommissionTerm,
} from "./lib/affiliateCommission";
import { sellerCostFields, costBillFields } from "./lib/sellerCostValidators";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  storePlanIdValidator,
  storePlanRecordValidator,
  storeSaleRecordFields,
} from "./lib/storePlanValidators";

export default defineSchema({
  // Mock users (no auth — just IDs and roles)
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("customer"),
      v.literal("seller"),
      v.literal("admin"),
      v.literal("visitor"),
      // Marketplace personas (BTS-41): a buyer is a billable customer_account;
      // an affiliate is a recipient-only account that earns referral transfers.
      v.literal("buyer"),
      v.literal("affiliate"),
    ),
    storePlan: v.optional(storePlanRecordValidator),
    testFixture: v.optional(v.boolean()),
    avatarUrl: v.optional(v.string()),
    // Marketplace sellers own a store; platform-owned products are tagged to
    // the seller's account id. Undefined for non-store personas.
    storeName: v.optional(v.string()),
    // V2 Stripe account (acct_…) linked to this persona, written back by the
    // seed once the account is created. Undefined for personas with no account
    // (e.g. admin, visitor) or before seeding has linked them.
    stripeAccountId: v.optional(v.string()),
  })
    .index("by_test_fixture", ["testFixture"])
    .index("by_role", ["role"])
    .index("by_email", ["email"])
    .index("by_stripe_account", ["stripeAccountId"]),

  storeBalanceFunding: defineTable({
    sellerId: v.id("users"),
    subscriptionId: v.string(),
    enabled: v.boolean(),
    paymentMethodId: v.string(),
    previousPaymentMethodId: v.optional(v.string()),
    previousPaymentMethodTypes: v.optional(v.array(v.string())),
    operationVersion: v.optional(v.number()),
    operationPending: v.optional(v.boolean()),
    targetEnabled: v.optional(v.boolean()),
    consentAt: v.number(),
  }).index("by_seller", ["sellerId"]),
  affiliateDefaults: defineTable({
    sellerId: v.optional(v.id("users")),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.union(v.number(), v.null()),
    affiliateFixedAmount: v.union(v.number(), v.null()),
    version: v.number(),
  }).index("by_seller", ["sellerId"]),
  sellerAffiliateRates: defineTable({
    sellerId: v.id("users"),
    stripeProductId: v.string(),
    stripePriceId: v.optional(v.string()),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.union(v.number(), v.null()),
    affiliateFixedAmount: v.optional(v.union(v.number(), v.null())),
    version: v.number(),
  }).index("by_target", ["sellerId", "stripeProductId", "stripePriceId"]),
  storePlanSettings: defineTable({
    planId: storePlanIdValidator,
    monthlyAmount: v.number(),
    feeBasisPoints: v.union(v.number(), v.null()),
    affiliateCommissionTerm: optionalCommissionTerm,
    affiliateBasisPoints: v.optional(v.union(v.number(), v.null())),
    affiliateFixedAmount: v.optional(v.union(v.number(), v.null())),
    version: v.number(),
  }).index("by_plan", ["planId"]),
  storePlanCatalog: defineTable({
    planId: storePlanIdValidator,
    stripeProductId: v.string(),
    stripePriceId: v.string(),
  }).index("by_plan", ["planId"]),
  subscriptionCommissions: defineTable({
    stripeSubscriptionId: v.string(),
    affiliateCommissionTerm: commissionTerm,
    firstInvoiceId: v.string(),
    affiliateAccountId: v.optional(v.string()),
  }).index("by_subscription", ["stripeSubscriptionId"]),
  storeSales: defineTable(storeSaleRecordFields)
    .index("by_charge", ["chargeId"])
    // Sales history must remain chronological across currencies and recovery states.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_seller", ["sellerId"])
    .index("by_recovery", [
      "sellerId",
      "currency",
      "status",
      "costRecoveryAmount",
    ]),

  sellerCosts: defineTable(sellerCostFields)
    .index("by_charge", ["sourceChargeId"])
    // History must sort all costs by creation time, independently of open status.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_seller", ["sellerId"])
    .index("by_seller_open", ["sellerId", "open"])
    .index("by_recovery_version", ["sellerId", "recoveryVersion"]),
  storeCostBills: defineTable(costBillFields).index("by_invoice", [
    "invoiceId",
  ]),
  sandboxFixtureJobs: defineTable({
    version: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    cursor: v.number(),
    total: v.number(),
    attempts: v.number(),
    updatedAt: v.number(),
    error: v.optional(v.string()),
  }).index("by_version", ["version"]),
  sandboxFixtureResources: defineTable({
    key: v.string(),
    stripeId: v.string(),
    kind: v.string(),
  }).index("by_key", ["key"]),

  // E2E observability: every sync trigger / async hook invocation records a
  // row here so the webhook E2E test can assert the trigger system ran.
  triggerLog: defineTable({
    source: v.union(v.literal("trigger"), v.literal("hook")),
    kind: v.string(),
    stripeId: v.string(),
  }).index("by_kind", ["kind"]),
});
