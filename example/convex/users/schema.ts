import { defineTable } from "convex/server";
import { v } from "convex/values";
import { storePlanRecordValidator } from "../storePlans/validators";
export const usersTables = {
  // Mock users (no auth — just IDs and roles)
  users: defineTable({
    authTokenIdentifier: v.optional(v.string()),
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
    .index("by_auth_token", ["authTokenIdentifier"])
    .index("by_test_fixture", ["testFixture"])
    .index("by_role", ["role"])
    .index("by_email", ["email"])
    .index("by_stripe_account", ["stripeAccountId"]),
};
