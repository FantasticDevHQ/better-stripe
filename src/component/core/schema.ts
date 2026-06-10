import { defineTable } from "convex/server";

import { accountFields } from "./validators";

/**
 * V2 Accounts (replaces standard Stripe Customers).
 * Each account maps a Stripe V2 account to a user/org in the host app.
 */
export const accountsTable = defineTable(accountFields)
  .index("by_stripe_account_id", ["stripeAccountId"])
  .index("by_user_id", ["userId"])
  .index("by_org_id", ["orgId"])
  .index("by_onboarding_status", ["onboardingStatus"]);
