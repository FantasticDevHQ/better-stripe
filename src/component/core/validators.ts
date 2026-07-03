import { type Infer, v } from "convex/values";

export const appliedConfigurationValidator = v.union(
  v.literal("customer"),
  v.literal("merchant"),
  v.literal("recipient"),
);
export type AppliedConfiguration = Infer<typeof appliedConfigurationValidator>;

export const appliedConfigurationsValidator = v.optional(
  v.array(appliedConfigurationValidator),
);

export const onboardingStatusValidator = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("complete"),
  v.literal("restricted"),
);
export type OnboardingStatus = Infer<typeof onboardingStatusValidator>;

export const optionalOnboardingStatusValidator = v.optional(
  onboardingStatusValidator,
);

/**
 * Field validators for the `accounts` table.
 * Shared between the schema definition and the doc validator so the
 * two can never drift apart.
 */
export const accountFields = {
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
  // Per-store statement-descriptor suffix shown on buyers' card statements
  // for destination charges to this account (BTS-32).
  statementDescriptor: v.optional(v.string()),
};

/** Full `accounts` document, including system fields. */
export const accountDocValidator = v.object({
  _id: v.id("accounts"),
  _creationTime: v.number(),
  ...accountFields,
});
