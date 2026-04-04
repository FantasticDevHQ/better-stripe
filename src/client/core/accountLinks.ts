import type Stripe from "stripe";

import type { RunCtx } from "../helpers.js";
import type {
  V2AccountLinkCreateParams,
  V2AppliedConfiguration,
} from "../stripe-types.js";
import type { AccountLinkWithStatus } from "../types.js";

// =============================================================================
// Account Link methods
// =============================================================================

export async function createAccountLink(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    refreshUrl: string;
    returnUrl: string;
    type: "account_onboarding" | "account_update";
  },
) {
  const accountLink = await stripe.accountLinks.create({
    account: opts.stripeAccountId,
    refresh_url: opts.refreshUrl,
    return_url: opts.returnUrl,
    type: opts.type,
  });
  return { url: accountLink.url };
}

export async function createV2AccountLink(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    type: "account_onboarding" | "account_update";
    refreshUrl: string;
    returnUrl: string;
    configurations?: string[];
  },
) {
  const useCase: V2AccountLinkCreateParams["use_case"] =
    opts.type === "account_update"
      ? {
          type: "account_update",
          account_update: {
            configurations: (opts.configurations ??
              []) as V2AppliedConfiguration[],
            refresh_url: opts.refreshUrl,
            return_url: opts.returnUrl,
          },
        }
      : {
          type: "account_onboarding",
          account_onboarding: {
            configurations: (opts.configurations ??
              []) as V2AppliedConfiguration[],
            refresh_url: opts.refreshUrl,
            return_url: opts.returnUrl,
          },
        };

  const accountLink = await stripe.v2.core.accountLinks.create({
    account: opts.stripeAccountId,
    use_case: useCase,
  });

  return {
    url: accountLink.url,
    expiresAt: accountLink.expires_at,
  };
}

export async function createLoginLink(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeAccountId: string },
) {
  const loginLink = await stripe.accounts.createLoginLink(opts.stripeAccountId);
  return { url: loginLink.url };
}

/**
 * Get an account link with status detection.
 * Determines the appropriate link type based on account state.
 */
export async function getAccountLinkWithStatus(
  stripe: Stripe,
  ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    refreshUrl: string;
    returnUrl: string;
  },
): Promise<AccountLinkWithStatus> {
  const account = await stripe.v2.core.accounts.retrieve(opts.stripeAccountId, {
    include: [
      "configuration.merchant",
      "configuration.recipient",
      "configuration.customer",
    ],
  });

  const getOnboardingLink = async (): Promise<AccountLinkWithStatus> => {
    const configs = account.applied_configurations ?? [];
    const link = await createV2AccountLink(stripe, ctx, {
      stripeAccountId: opts.stripeAccountId,
      type: "account_onboarding",
      configurations: configs,
      refreshUrl: opts.refreshUrl,
      returnUrl: opts.returnUrl,
    });
    return { url: link.url, linkType: "onboarding" };
  };

  if (
    account.requirements?.entries &&
    account.requirements.entries.length > 0
  ) {
    return getOnboardingLink();
  }

  if (account.dashboard === "express") {
    try {
      const loginLinkResult = await createLoginLink(stripe, ctx, {
        stripeAccountId: opts.stripeAccountId,
      });
      return { url: loginLinkResult.url, linkType: "login" };
    } catch (loginLinkError) {
      console.warn(
        `[better-stripe] Login link creation failed for ${opts.stripeAccountId}, falling back to onboarding:`,
        loginLinkError,
      );
      return getOnboardingLink();
    }
  }

  return getOnboardingLink();
}

export async function createBillingPortalSession(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeAccountId: string; returnUrl: string },
) {
  const session = await stripe.billingPortal.sessions.create({
    customer_account: opts.stripeAccountId,
    return_url: opts.returnUrl,
  });
  return { url: session.url };
}

export async function getCountrySpecs(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { countryCode: string },
) {
  return await stripe.countrySpecs.retrieve(opts.countryCode);
}
