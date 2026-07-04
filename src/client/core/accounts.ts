import type Stripe from "stripe";

import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { throwStripeError } from "../errors.js";
import type {
  V2AccountCreateParams,
  V2AccountUpdateParams,
  V2AccountRetrieveInclude,
  V2CloseAppliedConfiguration,
} from "../stripe-types.js";
import type { StripeComponentAccount } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";
import { validateStatementDescriptorSuffix } from "./descriptors.js";
import { deriveAccountStatus } from "./accountStatus.js";

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

  const createParams: V2AccountCreateParams = {
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
    componentRef(component, "core/mutations/upsertAccount"),
    {
      stripeAccountId: account.id,
      userId: opts.userId,
      orgId: opts.orgId,
      email: opts.email,
      name: opts.name,
      country: opts.country,
      appliedConfigurations: [] as ("customer" | "merchant" | "recipient")[],
      onboardingStatus: "pending" as const,
      metadata,
    },
  );

  const stored = await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByStripeId"),
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
    losses_collector: "application",
    fees_collector: "application",
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
    dashboard?: "express" | "full" | "none";
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
      dashboard: opts.dashboard ?? "express",
      defaults,
    } as V2AccountUpdateParams);
  } catch (configError) {
    // Roll back: delete the half-created account from Convex so retries
    // don't get stuck on an unusable pending account
    try {
      await runMutationOrThrow(
        ctx,
        componentRef(component, "core/mutations/deleteAccountByStripeId"),
        { stripeAccountId: result.stripeAccountId },
      );
    } catch {
      // Best effort cleanup
    }
    throwStripeError("ACCOUNT_CREATE_FAILED", "Failed to apply account configuration after create; account was rolled back", configError);
  }

  // Re-fetch account to get actual applied_configurations from Stripe
  const updatedAccount = await stripe.v2.core.accounts.retrieve(
    result.stripeAccountId,
  );
  const appliedConfigs = updatedAccount.applied_configurations ?? [];

  // Update our DB with the applied configurations
  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/upsertAccount"),
    {
      stripeAccountId: result.stripeAccountId,
      userId: opts.userId,
      appliedConfigurations: appliedConfigs,
      onboardingStatus: "in_progress" as const,
    },
  );

  const accountLink = await stripe.accountLinks.create({
    account: result.stripeAccountId,
    refresh_url: opts.refreshUrl,
    return_url: opts.returnUrl,
    type: "account_onboarding",
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
    componentRef(component, "core/queries/getAccount"),
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
        componentRef(component, "core/queries/getAccountByOrgId"),
        {
          orgId: opts.orgId,
        },
      )
    : await ctx.runQuery(
        componentRef(component, "core/queries/getAccountByUserId"),
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

/**
 * Ensure a shopper has a V2 account with the `customer` configuration applied,
 * creating the account if needed (BTS-18). Idempotent: an account that already
 * has the customer configuration is returned untouched, and other
 * configurations (e.g. `merchant`) are preserved — embodying the "one V2
 * account, configurations accrue" model. Returns the buyer's `stripeAccountId`
 * to pass as `customer_account` on checkout/subscriptions.
 */
export async function ensureCustomerAccount(
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
): Promise<{
  stripeAccountId: string;
  accountId: string | null;
  appliedConfigurations: string[];
  isNew: boolean;
}> {
  const account = await getOrCreateAccount(stripe, component, ctx, opts);

  // A freshly-created account has no applied configurations yet; an existing one
  // may already have `customer` (and others). Only apply when missing.
  let appliedConfigurations: string[] = [];
  if (!account.isNew) {
    const doc = (await ctx.runQuery(
      componentRef(component, "core/queries/getAccountByStripeId"),
      { stripeAccountId: account.stripeAccountId },
    )) as StripeComponentAccount | null;
    appliedConfigurations = doc?.appliedConfigurations ?? [];
  }

  if (!appliedConfigurations.includes("customer")) {
    const res = await addCustomerConfiguration(stripe, component, ctx, {
      stripeAccountId: account.stripeAccountId,
    });
    appliedConfigurations = res.appliedConfigurations;
  }

  return {
    stripeAccountId: account.stripeAccountId,
    accountId: account.accountId ?? null,
    appliedConfigurations,
    isNew: account.isNew,
  };
}

export async function getAccountByUserId(
  component: Component,
  ctx: RunCtx,
  opts: { userId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByUserId"),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getAccountByOrgId(
  component: Component,
  ctx: RunCtx,
  opts: { orgId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByOrgId"),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getAccountByStripeId(
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<StripeComponentAccount | null> {
  return (await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByStripeId"),
    opts,
  )) as StripeComponentAccount | null;
}

export async function getAccountOnboardingStatus(
  component: Component,
  ctx: RunCtx,
  opts: { accountId: string },
) {
  return ctx.runQuery(
    componentRef(component, "core/queries/getAccountOnboardingStatus"),
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
    onboardingStatus?: "pending" | "in_progress" | "complete" | "restricted";
    missingRequirements?: string[];
    metadata?: Record<string, unknown>;
  },
) {
  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/upsertAccount"),
    opts,
  );
  return null;
}

/**
 * Store (or clear, with `null`) a per-store statement-descriptor suffix on the
 * seller's component account record (BTS-32). Validated against Stripe's
 * descriptor rules before writing; destination charges to this account then
 * carry the suffix so buyers recognize the store on their card statement.
 */
export async function setAccountStatementDescriptor(
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string; statementDescriptor: string | null },
) {
  const statementDescriptor =
    opts.statementDescriptor === null
      ? null
      : validateStatementDescriptorSuffix(opts.statementDescriptor);
  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/setStatementDescriptor"),
    { stripeAccountId: opts.stripeAccountId, statementDescriptor },
  );
  return { success: true };
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
  const updateParams: V2AccountUpdateParams = {};
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
    include?: V2AccountRetrieveInclude[];
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
    updateParams: V2AccountUpdateParams;
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

  for await (const account of stripe.v2.core.accounts.list({
    limit: opts?.limit ?? 100,
  })) {
    accounts.push(account);
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
    componentRef(component, "core/queries/getAccountByStripeId"),
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
    applied_configurations: appliedConfigs as V2CloseAppliedConfiguration[],
  });

  // Only remove from component DB after Stripe close succeeds
  // This prevents Convex/Stripe getting out of sync if close fails
  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/deleteAccountByStripeId"),
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

/**
 * Default V2 customer configuration. Applying the customer configuration is
 * what makes a V2 Account billable — the customer-facing payment/billing flows
 * (subscriptions, invoices, billing portal). In the V2 Accounts API a single
 * Account with this configuration replaces the legacy V1 Customer object, so
 * `customer_account: acct_…` is what you pass to subscriptions, setup intents,
 * and billing-portal sessions. No capabilities are requested by default;
 * request `customer.capabilities.automatic_indirect_tax` separately if you need
 * automatic tax on this account's invoices/subscriptions.
 */
export const DEFAULT_CUSTOMER_CONFIGURATION: Record<string, unknown> = {
  customer: {},
};

/**
 * Apply the customer configuration to an existing V2 Account, making it
 * billable, and record the resulting applied configurations on the component
 * account. The account must already exist in the component DB (e.g. created via
 * `createAccount`); its owning `userId` is recovered from that record.
 */
export async function addCustomerConfiguration(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<{ success: true; appliedConfigurations: string[] }> {
  const existing = (await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByStripeId"),
    { stripeAccountId: opts.stripeAccountId },
  )) as StripeComponentAccount | null;

  if (!existing) {
    throwStripeError(
      "ACCOUNT_NOT_FOUND",
      `No component account found for ${opts.stripeAccountId}; create it before applying the customer configuration`,
    );
  }

  await stripe.v2.core.accounts.update(opts.stripeAccountId, {
    configuration: DEFAULT_CUSTOMER_CONFIGURATION,
  } as V2AccountUpdateParams);

  // Re-fetch to record the configurations Stripe actually applied
  const updated = await stripe.v2.core.accounts.retrieve(opts.stripeAccountId);
  const appliedConfigurations = updated.applied_configurations ?? [];

  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/upsertAccount"),
    {
      stripeAccountId: opts.stripeAccountId,
      userId: existing.userId,
      appliedConfigurations,
    },
  );

  return { success: true, appliedConfigurations };
}

/**
 * Apply the V2 recipient configuration to an existing account, and record the
 * resulting applied configurations on the component account. The account must
 * already exist in the component DB (e.g. from {@link createAccount}); its
 * owning `userId` is recovered from that record, matching
 * {@link addCustomerConfiguration}.
 */
export async function addRecipientConfiguration(
  stripe: Stripe,
  component: Component,
  ctx: RunCtx,
  opts: { stripeAccountId: string },
): Promise<{ success: true; appliedConfigurations: string[] }> {
  const existing = (await ctx.runQuery(
    componentRef(component, "core/queries/getAccountByStripeId"),
    { stripeAccountId: opts.stripeAccountId },
  )) as StripeComponentAccount | null;

  if (!existing) {
    throwStripeError(
      "ACCOUNT_NOT_FOUND",
      `No component account found for ${opts.stripeAccountId}; create it before applying the recipient configuration`,
    );
  }

  await stripe.v2.core.accounts.update(opts.stripeAccountId, {
    configuration: {
      recipient: {
        // V2 (API 2026-05-27.dahlia) requires the `capabilities` wrapper with an
        // explicit `requested: true`. The bare `recipient.stripe_balance` shape
        // is rejected with "Unknown field" (confirmed against the Stripe sandbox).
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
  } as V2AccountUpdateParams);

  // Re-fetch to record the configurations Stripe actually applied
  const updated = await stripe.v2.core.accounts.retrieve(opts.stripeAccountId);
  const appliedConfigurations = updated.applied_configurations ?? [];

  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/upsertAccount"),
    {
      stripeAccountId: opts.stripeAccountId,
      userId: existing.userId,
      appliedConfigurations,
    },
  );

  return { success: true, appliedConfigurations };
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

  for await (const account of stripe.v2.core.accounts.list({ limit: 20 })) {
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
              .join(" ") || undefined
          : undefined);

      await runMutationOrThrow(
        ctx,
        componentRef(component, "core/mutations/upsertAccount"),
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
        `Account ${account.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { synced, errors, errorCount: errors.length };
}
