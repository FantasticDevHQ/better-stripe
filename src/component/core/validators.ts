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
