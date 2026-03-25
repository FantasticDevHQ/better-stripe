import type Stripe from 'stripe';

import type { Component, RunCtx } from '../helpers.js';
import { runMutationOrThrow } from '../helpers.js';
import type { StripeComponentAccount } from '../types.js';
import { componentRef } from '../webhooks/helpers.js';
import { deriveAccountStatus } from './accountStatus.js';

// =============================================================================
// Account CRUD
// =============================================================================

export async function createAccount(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    userId: string;
    email?: string;
    name?: string;
    country?: string;
    orgId?: string;
    metadata?: Record<string, string>;
  },
) {
  const metadata = {
    ...(opts.metadata ?? {}),
    userId: opts.userId,
    ...(opts.orgId ? { orgId: opts.orgId } : {}),
  };

  const createParams: Stripe.V2.Core.AccountCreateParams = {
    contact_email: opts.email,
    metadata,
  };
  if (opts.country) {
    createParams.identity = {
      country: opts.country,
    };
  }

  const account = await stripe.v2.core.accounts.create(createParams);

  await runMutationOrThrow(
    ctx,
    componentRef(component, 'core/mutations/upsertAccount'),
    {
      stripeAccountId: account.id,
      userId: opts.userId,
      orgId: opts.orgId,
      email: opts.email,
      name: opts.name,
      country: opts.country,
      appliedConfigurations: [] as ('customer' | 'merchant' | 'recipient')[],
      onboardingStatus: 'pending' as const,
      metadata,
    },
  );

  const stored = await ctx.runQuery(
    componentRef(component, 'core/queries/getAccountByStripeId'),
    { stripeAccountId: account.id },
  );

  return {
    accountId: stored?._id ?? null,
    stripeAccountId: account.id,
  };
}

/**
 * Default V2 account configuration: merchant with card_payments.
 */
export const DEFAULT_ACCOUNT_CONFIGURATION: Record<string, unknown> = {
  merchant: {
    capabilities: { card_payments: { requested: true } },
  },
};

export const DEFAULT_ACCOUNT_DEFAULTS: Record<string, unknown> = {
  responsibilities: {
    losses_collector: 'application',
    fees_collector: 'application',
  },
};

export async function createAccountWithOnboarding(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    userId: string;
    email?: string;
    name?: string;
    country: string;
    orgId?: string;
    metadata?: Record<string, string>;
    refreshUrl: string;
    returnUrl: string;
    accountConfiguration?: Record<string, unknown>;
    accountDefaults?: Record<string, unknown>;
    dashboard?: 'express' | 'full' | 'none';
  },
): Promise<{
  stripeAccountId: string;
  onboardingUrl: string;
}> {
  const result = await createAccount(stripe, component, ctx, {
    userId: opts.userId,
    email: opts.email,
    name: opts.name,
    country: opts.country,
    orgId: opts.orgId,
    metadata: opts.metadata,
  });

  const configuration =
    opts.accountConfiguration ?? DEFAULT_ACCOUNT_CONFIGURATION;
  const defaults = opts.accountDefaults ?? DEFAULT_ACCOUNT_DEFAULTS;

  try {
    // Apply configuration — this must succeed for onboarding to work correctly
    await stripe.v2.core.accounts.update(result.stripeAccountId, {
      configuration,
      dashboard: opts.dashboard ?? 'express',
      defaults,
    } as Stripe.V2.Core.AccountUpdateParams);
  } catch (configError) {
    // Roll back: delete the half-created account from Convex so retries
    // don't get stuck on an unusable pending account
    try {
      await runMutationOrThrow(
        ctx,
        componentRef(component, 'core/mutations/deleteAccountByStripeId'),
        { stripeAccountId: result.stripeAccountId },
      );
    } catch {
      // Best effort cleanup
    }
    throw configError;
  }

  // Re-fetch account to get actual applied_configurations from Stripe
  const updatedAccount = await stripe.v2.core.accounts.retrieve(
    result.stripeAccountId,
  );
  const appliedConfigs = updatedAccount.applied_configurations ?? [];

  // Update our DB with the applied configurations
  await runMutationOrThrow(
    ctx,
    componentRef(component, 'core/mutations/upsertAccount'),
    {
      stripeAccountId: result.stripeAccountId,
      userId: opts.userId,
      appliedConfigurations: appliedConfigs,
      onboardingStatus: 'in_progress' as const,
    },
  );

  const accountLink = await stripe.accountLinks.create({
    account: result.stripeAccountId,
    refresh_url: opts.refreshUrl,
    return_url: opts.returnUrl,
    type: 'account_onboarding',
  });

  return {
    stripeAccountId: result.stripeAccountId,
    onboardingUrl: accountLink.url,
  };
}

export async function getAccount(
  component: Component,
  ctx: RunCtx,
  opts: { accountId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, 'core/queries/getAccount'),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getOrCreateAccount(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: {
    userId: string;
    email?: string;
    name?: string;
    country?: string;
    orgId?: string;
    metadata?: Record<string, string>;
  },
) {
  const existing = opts.orgId
    ? await ctx.runQuery(
        componentRef(component, 'core/queries/getAccountByOrgId'),
        {
          orgId: opts.orgId,
        },
      )
    : await ctx.runQuery(
        componentRef(component, 'core/queries/getAccountByUserId'),
        {
          userId: opts.userId,
        },
      );

  if (existing) {
    return {
      accountId: existing._id,
      stripeAccountId: existing.stripeAccountId,
      isNew: false,
    };
  }

  const result = await createAccount(stripe, component, ctx, opts);
  return { ...result, isNew: true };
}

export async function getAccountByUserId(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, 'core/queries/getAccountByUserId'),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getAccountByOrgId(
  component: Component,
  ctx: RunCtx,
  opts: { orgId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, 'core/queries/getAccountByOrgId'),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getAccountByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, 'core/queries/getAccountByStripeId'),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getAccountOnboardingStatus(
  component: Component,
  ctx: RunCtx,
  opts: { accountId: string },
) {
  return ctx.runQuery(
    componentRef(component, 'core/queries/getAccountOnboardingStatus'),
    opts,
  );
}

export async function upsertAccount(
  component: Component,
  ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    userId: string;
    orgId?: string;
    email?: string;
    name?: string;
    country?: string;
    capabilities?: Record<string, unknown>;
    requirements?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
    onboardingStatus?: 'pending' | 'in_progress' | 'complete' | 'restricted';
    missingRequirements?: string[];
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, 'core/mutations/upsertAccount'),
    opts,
  );
  return null;
}

export async function updateAccount(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  },
) {
  const updateParams: Stripe.V2.Core.AccountUpdateParams = {};
  if (opts.email) updateParams.contact_email = opts.email;
  if (opts.metadata) updateParams.metadata = opts.metadata;
  await stripe.v2.core.accounts.update(opts.stripeAccountId, updateParams);
  return { success: true };
}

export async function getV2Account(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    include?: Stripe.V2.Core.AccountRetrieveParams.Include[];
  },
): Promise<Stripe.V2.Core.Account> {
  return await stripe.v2.core.accounts.retrieve(opts.stripeAccountId, {
    include: opts.include,
  });
}

export async function updateV2Account(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: {
    stripeAccountId: string;
    updateParams: Stripe.V2.Core.AccountUpdateParams;
  },
): Promise<Stripe.V2.Core.Account> {
  return await stripe.v2.core.accounts.update(
    opts.stripeAccountId,
    opts.updateParams,
  );
}

export async function listStripeAccounts(
  stripe: Stripe,
  _ctx: RunCtx,
  opts?: { limit?: number },
): Promise<Stripe.V2.Core.Account[]> {
  const accounts: Stripe.V2.Core.Account[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  // TODO: Remove manual pagination when Stripe SDK adds starting_after to AccountListParams
  while (hasMore) {
    const listParams: Stripe.V2.Core.AccountListParams & {
      starting_after?: string;
    } = {
      limit: opts?.limit ?? 100,
    };
    if (startingAfter) listParams.starting_after = startingAfter;

    const page = await stripe.v2.core.accounts.list(listParams);
    const data = page.data ?? [];
    accounts.push(...data);
    hasMore = page.has_more ?? false;
    startingAfter = data.length > 0 ? data[data.length - 1]?.id : undefined;
    if (data.length === 0) hasMore = false;
  }

  return accounts;
}

export async function closeAccount(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<{ closed: boolean }> {
  // First check our DB for stored applied_configurations
  let appliedConfigs: string[] = [];

  const dbAccount = await ctx.runQuery(
    componentRef(component, 'core/queries/getAccountByStripeId'),
    { stripeAccountId: opts.stripeAccountId },
  );
  if (dbAccount?.appliedConfigurations) {
    appliedConfigs = dbAccount.appliedConfigurations;
  } else {
    // Fallback: fetch from Stripe
    try {
      const stripeAccount = await stripe.v2.core.accounts.retrieve(
        opts.stripeAccountId,
      );
      appliedConfigs = stripeAccount.applied_configurations ?? [];
    } catch {
      // Account may not exist on Stripe
    }
  }

  // Close the account on Stripe — must pass all applied_configurations
  // See: https://docs.stripe.com/api/v2/core/accounts/close
  await stripe.v2.core.accounts.close(opts.stripeAccountId, {
    applied_configurations:
      appliedConfigs as Stripe.V2.Core.AccountCloseParams.AppliedConfiguration[],
  });

  // Only remove from component DB after Stripe close succeeds
  // This prevents Convex/Stripe getting out of sync if close fails
  await runMutationOrThrow(
    ctx,
    componentRef(component, 'core/mutations/deleteAccountByStripeId'),
    { stripeAccountId: opts.stripeAccountId },
  );

  return { closed: true };
}

export async function restartAccountOnboarding(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<{ closed: boolean }> {
  return closeAccount(stripe, component, ctx, opts);
}

export async function addRecipientConfiguration(
  stripe: Stripe,
  _ctx: RunCtx,
  opts: { stripeAccountId: string },
) {
  await stripe.v2.core.accounts.update(opts.stripeAccountId, {
    configuration: {
      recipient: {
        stripe_balance: {
          stripe_transfers: {},
        },
      },
    },
  } as Stripe.V2.Core.AccountUpdateParams);
  return { success: true };
}

// =============================================================================
// Sync
// =============================================================================

export async function syncAllAccounts(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
) {
  let synced = 0;
  const errors: string[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    // TODO: Remove manual pagination when Stripe SDK adds starting_after to AccountListParams
    const params: Stripe.V2.Core.AccountListParams & {
      starting_after?: string;
    } = { limit: 20 };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripe.v2.core.accounts.list(params);
    const data = page.data ?? [];

    for (const account of data) {
      try {
        const identity = account.identity;
        const metadata = (account.metadata ?? {}) as Record<string, string>;
        const userId = metadata.userId ?? metadata.user_id ?? account.id;
        const orgId = metadata.orgId ?? metadata.org_id ?? undefined;
        const { onboardingStatus, missingRequirements } =
          deriveAccountStatus(account);

        // V2 Account uses contact_email at account level, individual.email in identity
        const email =
          account.contact_email ?? identity?.individual?.email ?? undefined;
        // V2 uses registered_name for business, given_name + surname for individual
        const name =
          identity?.business_details?.registered_name ??
          (identity?.individual
            ? [identity.individual.given_name, identity.individual.surname]
                .filter(Boolean)
                .join(' ') || undefined
            : undefined);

        await runMutationOrThrow(
          ctx,
          componentRef(component, 'core/mutations/upsertAccount'),
          {
            stripeAccountId: account.id,
            userId,
            orgId,
            email,
            name,
            country: identity?.country ?? undefined,
            configuration: account.configuration ?? undefined,
            requirements: account.requirements ?? undefined,
            onboardingStatus,
            missingRequirements,
            metadata,
          },
        );
        synced++;
      } catch (error) {
        errors.push(
          `Account ${account.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    hasMore = page.has_more ?? false;
    if (data.length > 0) {
      startingAfter = data[data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  return { synced, errors, errorCount: errors.length };
}
