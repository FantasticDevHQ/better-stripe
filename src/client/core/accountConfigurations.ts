import type Stripe from "stripe";
import type { Component, RunCtx } from "../helpers.js";
import { runMutationOrThrow } from "../helpers.js";
import { throwStripeError } from "../errors.js";
import type { V2AccountUpdateParams } from "../stripe-types.js";
import type { StripeComponentAccount } from "../types.js";
import { componentRef } from "../webhooks/helpers.js";
import { DEFAULT_ACCOUNT_CONFIGURATION } from "./accountDefaults.js";

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
      ...(existing.orgId !== undefined ? { orgId: existing.orgId } : {}),
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
      ...(existing.orgId !== undefined ? { orgId: existing.orgId } : {}),
      appliedConfigurations,
    },
  );

  return { success: true, appliedConfigurations };
}

/** Request merchant card payments and refresh only this account's applied configurations. */
export async function addMerchantConfiguration(
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
      `No component account found for ${opts.stripeAccountId}; create it before applying the merchant configuration`,
    );
  }
  await stripe.v2.core.accounts.update(opts.stripeAccountId, {
    configuration: DEFAULT_ACCOUNT_CONFIGURATION,
  } as V2AccountUpdateParams);
  const updated = await stripe.v2.core.accounts.retrieve(opts.stripeAccountId);
  const appliedConfigurations = updated.applied_configurations ?? [];
  await runMutationOrThrow(
    ctx,
    componentRef(component, "core/mutations/upsertAccount"),
    {
      stripeAccountId: opts.stripeAccountId,
      userId: existing.userId,
      ...(existing.orgId !== undefined ? { orgId: existing.orgId } : {}),
      appliedConfigurations,
    },
  );
  return { success: true, appliedConfigurations };
}
