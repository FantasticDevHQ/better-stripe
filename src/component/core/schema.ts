import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  appliedConfigurationsValidator,
  onboardingStatusValidator,
} from './validators';

/**
 * V2 Accounts (replaces standard Stripe Customers).
 * Each account maps a Stripe V2 account to a user/org in the host app.
 */
export const accountsTable = defineTable({
  stripeAccountId: v.string(),
  userId: v.string(),
  orgId: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  country: v.optional(v.string()),
  capabilities: v.optional(v.any()),
  requirements: v.optional(v.any()),
  configuration: v.optional(v.any()),
  appliedConfigurations: appliedConfigurationsValidator,
  onboardingStatus: onboardingStatusValidator,
  missingRequirements: v.optional(v.array(v.string())),
  metadata: v.optional(v.any()),
})
  .index('by_stripe_account_id', ['stripeAccountId'])
  .index('by_user_id', ['userId'])
  .index('by_org_id', ['orgId'])
  .index('by_onboarding_status', ['onboardingStatus']);
