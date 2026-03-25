import type Stripe from 'stripe';

export type BetterStripeOnboardingStatus =
  | 'pending'
  | 'in_progress'
  | 'complete'
  | 'restricted';

/**
 * Accepts a V2 Account (or partial shape with configuration/requirements).
 */
type StripeAccountLike = Pick<
  Partial<Stripe.V2.Core.Account>,
  'configuration' | 'requirements'
>;

export function deriveAccountStatus(account: StripeAccountLike): {
  onboardingStatus: BetterStripeOnboardingStatus;
  missingRequirements: string[];
} {
  const requirements = account.requirements;
  const entries = requirements?.entries ?? [];

  // V2 requirements use entries[].description as the requirement identifier
  const missingRequirements = Array.from(
    new Set(
      entries
        .map((entry) => entry.description)
        .filter((value): value is string => typeof value === 'string'),
    ),
  );

  // Check deadline status for disabled-like conditions
  const deadlineStatus = requirements?.summary?.minimum_deadline?.status;
  if (deadlineStatus === 'past_due') {
    return {
      onboardingStatus: 'restricted',
      missingRequirements,
    };
  }

  // Check if any entry has capability restrictions
  const hasRestrictingImpact = entries.some(
    (entry) =>
      (entry.impact?.restricts_capabilities?.length ?? 0) > 0 &&
      entry.awaiting_action_from === 'user',
  );

  if (hasRestrictingImpact && missingRequirements.length > 0) {
    return {
      onboardingStatus: 'restricted',
      missingRequirements,
    };
  }

  if (missingRequirements.length > 0) {
    return {
      onboardingStatus: 'in_progress',
      missingRequirements,
    };
  }

  const configuration = account.configuration;
  if (!configuration) {
    return {
      onboardingStatus: 'pending',
      missingRequirements,
    };
  }

  // V2 configurations use `applied: boolean` to indicate active state
  const configs = [
    configuration.customer,
    configuration.merchant,
    configuration.recipient,
  ].filter(Boolean);

  if (configs.length === 0) {
    return {
      onboardingStatus: 'pending',
      missingRequirements,
    };
  }

  const allApplied = configs.every((cfg) => cfg?.applied === true);

  return {
    onboardingStatus: allApplied ? 'complete' : 'in_progress',
    missingRequirements,
  };
}
