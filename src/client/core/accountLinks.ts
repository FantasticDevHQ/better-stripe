import type Stripe from "stripe";

import { throwStripeError } from "../errors.js";
import type { RunCtx } from "../helpers.js";
import type { V2AccountLinkCreateParams } from "../stripe-types.js";
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
    /** @deprecated Endive collects requirements without configurations. Ignored. */
    configurations?: string[];
  },
) {
  const useCase: V2AccountLinkCreateParams["use_case"] =
    opts.type === "account_update"
      ? {
          type: "account_update",
          account_update: {
            refresh_url: opts.refreshUrl,
            return_url: opts.returnUrl,
          },
        }
      : {
          type: "account_onboarding",
          account_onboarding: {
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

/**
 * Create a Stripe Account Session for embedded components.
 * The returned client secret is consumed by Stripe Connect embedded
 * components on the frontend.
 */
/**
 * Create an embedded account session scoped to a seller's disputes (BTS-30), so
 * each seller can view and respond to their own disputes even though the platform
 * is merchant of record (Skool model). Returns the client secret to mount the
 * embedded `disputes_list` / `payment_disputes` components. Requires the
 * connected account to have an active charges/payments capability.
 */
export async function createDisputeSession(
  stripe: Stripe,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
) {
  return createAccountSession(stripe, ctx, {
    stripeAccountId: opts.stripeAccountId,
    components: {
      disputes_list: { enabled: true },
      payment_disputes: { enabled: true },
    },
  });
}

export async function createAccountSession(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    components: Stripe.AccountSessionCreateParams.Components;
  },
) {
  try {
    const session = await stripe.accountSessions.create({
      account: opts.stripeAccountId,
      components: opts.components,
    });
    return { clientSecret: session.client_secret };
  } catch (error) {
    throwStripeError(
      "STRIPE_API_ERROR",
      `Failed to create account session for ${opts.stripeAccountId}`,
      error,
    );
  }
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
    const link = await createV2AccountLink(stripe, ctx, {
      stripeAccountId: opts.stripeAccountId,
      type: "account_onboarding",
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

/** The connected account that owns the configuration and its customer data.
 * Omit for platform scope. Hosts must authorize both this scope and the customer.
 */
type BillingPortalScope = { connectedAccountId?: string };

export type CreateBillingPortalConfigurationOptions = BillingPortalScope & {
  /** Host-owned allowlists, proration, cancellation, and branding policy. */
  params: Stripe.BillingPortal.ConfigurationCreateParams;
};
export type RetrieveBillingPortalConfigurationOptions = BillingPortalScope & {
  configurationId: string;
};
export type UpdateBillingPortalConfigurationOptions = BillingPortalScope & {
  configurationId: string;
  params: Stripe.BillingPortal.ConfigurationUpdateParams;
};
export type CreateBillingPortalSessionOptions = BillingPortalScope & {
  /** Customer account opening the portal, distinct from connectedAccountId. */
  stripeAccountId: string;
  returnUrl: string;
  /** Omit to use Stripe's default portal configuration. */
  configurationId?: string;
};

export async function createBillingPortalConfiguration(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: CreateBillingPortalConfigurationOptions,
): Promise<Stripe.BillingPortal.Configuration> {
  try {
    return opts.connectedAccountId !== undefined
      ? await stripe.billingPortal.configurations.create(opts.params, {
          stripeAccount: opts.connectedAccountId,
        })
      : await stripe.billingPortal.configurations.create(opts.params);
  } catch (error) {
    throwStripeError(
      "STRIPE_API_ERROR",
      "Failed to create Billing Portal configuration",
      error,
    );
  }
}

export async function retrieveBillingPortalConfiguration(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: RetrieveBillingPortalConfigurationOptions,
): Promise<Stripe.BillingPortal.Configuration> {
  try {
    return opts.connectedAccountId !== undefined
      ? await stripe.billingPortal.configurations.retrieve(
          opts.configurationId,
          {},
          {
            stripeAccount: opts.connectedAccountId,
          },
        )
      : await stripe.billingPortal.configurations.retrieve(
          opts.configurationId,
        );
  } catch (error) {
    throwStripeError(
      "STRIPE_API_ERROR",
      "Failed to retrieve Billing Portal configuration",
      error,
    );
  }
}

export async function updateBillingPortalConfiguration(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: UpdateBillingPortalConfigurationOptions,
): Promise<Stripe.BillingPortal.Configuration> {
  try {
    return opts.connectedAccountId !== undefined
      ? await stripe.billingPortal.configurations.update(
          opts.configurationId,
          opts.params,
          {
            stripeAccount: opts.connectedAccountId,
          },
        )
      : await stripe.billingPortal.configurations.update(
          opts.configurationId,
          opts.params,
        );
  } catch (error) {
    throwStripeError(
      "STRIPE_API_ERROR",
      "Failed to update Billing Portal configuration",
      error,
    );
  }
}

export async function createBillingPortalSession(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: CreateBillingPortalSessionOptions,
) {
  const params: Stripe.BillingPortal.SessionCreateParams = {
    customer_account: opts.stripeAccountId,
    return_url: opts.returnUrl,
    ...(opts.configurationId !== undefined
      ? { configuration: opts.configurationId }
      : {}),
  };
  try {
    const session =
      opts.connectedAccountId !== undefined
        ? await stripe.billingPortal.sessions.create(params, {
            stripeAccount: opts.connectedAccountId,
          })
        : await stripe.billingPortal.sessions.create(params);
    return { url: session.url };
  } catch (error) {
    throwStripeError(
      "STRIPE_API_ERROR",
      "Failed to create Billing Portal session",
      error,
    );
  }
}

export async function getCountrySpecs(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { countryCode: string },
) {
  return await stripe.countrySpecs.retrieve(opts.countryCode);
}
