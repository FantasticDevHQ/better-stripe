import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Mock users (no auth — just IDs and roles)
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("customer"),
      v.literal("seller"),
      v.literal("admin"),
    ),
    avatarUrl: v.optional(v.string()),
    // V2 Stripe account (acct_…) linked to this persona, written back by the
    // seed once the account is created. Undefined for personas with no account
    // (e.g. admin) or before seeding has linked them.
    stripeAccountId: v.optional(v.string()),
  }),

  // E2E observability: every sync trigger / async hook invocation records a
  // row here so the webhook E2E test can assert the trigger system ran.
  triggerLog: defineTable({
    source: v.union(v.literal("trigger"), v.literal("hook")),
    kind: v.string(),
    stripeId: v.string(),
  }).index("by_kind", ["kind"]),
});
