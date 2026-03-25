// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from './_generated/api.js';
import schema from './schema.js';

const modules = import.meta.glob('./**/*.*s');

describe('core — account mutations and queries', () => {
  it('upsertAccount: inserts new account', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: 'acct_001',
      userId: 'user_001',
      name: 'Test Account',
      email: 'test@example.com',
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: 'user_001',
    });

    expect(account).not.toBeNull();
    expect(account!.stripeAccountId).toBe('acct_001');
    expect(account!.userId).toBe('user_001');
    expect(account!.name).toBe('Test Account');
    expect(account!.onboardingStatus).toBe('pending');
  });

  it('upsertAccount: updates existing account by stripeAccountId', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: 'acct_002',
      userId: 'user_002',
      name: 'Original Name',
    });

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: 'acct_002',
      userId: 'user_002',
      name: 'Updated Name',
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: 'user_002',
    });

    expect(account).not.toBeNull();
    expect(account!.name).toBe('Updated Name');
  });

  it('getAccountByUserId: returns matching account', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: 'acct_003',
      userId: 'user_003',
      email: 'found@example.com',
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: 'user_003',
    });

    expect(account).not.toBeNull();
    expect(account!.userId).toBe('user_003');
    expect(account!.email).toBe('found@example.com');
  });

  it('getAccountByUserId: returns null for unknown user', async () => {
    const t = convexTest(schema, modules);

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: 'user_nonexistent',
    });

    expect(account).toBeNull();
  });

  it('getAccountOnboardingStatus reflects missingRequirements and readiness', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: 'acct_004',
      userId: 'user_004',
      onboardingStatus: 'complete',
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: 'acct_004',
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status).not.toBeNull();
    expect(status!.isReady).toBe(true);
    expect(status!.onboardingStatus).toBe('complete');
    expect(status!.missingRequirements).toEqual([]);
  });
});

describe('products — product and price mutations and queries', () => {
  it('upsertProduct + getProductByStripeId round trip', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: 'prod_001',
      name: 'Pro Plan',
      active: true,
    });

    const product = await t.query(api.products.queries.getProductByStripeId, {
      stripeProductId: 'prod_001',
    });

    expect(product).not.toBeNull();
    expect(product!.name).toBe('Pro Plan');
    expect(product!.active).toBe(true);
  });

  it('upsertPrice + listPricesByProduct', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: 'prod_002',
      name: 'Starter Plan',
      active: true,
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: 'price_001',
      productId: 'internal_prod_002',
      stripeProductId: 'prod_002',
      unitAmount: 1000,
      currency: 'usd',
      active: true,
      type: 'recurring',
      interval: 'month',
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: 'price_002',
      productId: 'internal_prod_002',
      stripeProductId: 'prod_002',
      unitAmount: 10000,
      currency: 'usd',
      active: true,
      type: 'recurring',
      interval: 'year',
    });

    const prices = await t.query(api.products.queries.listPricesByProduct, {
      stripeProductId: 'prod_002',
    });

    expect(prices).toHaveLength(2);
  });
});

describe('billing — subscription mutations and queries', () => {
  it('upsertSubscription + getActiveSubscription', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: 'sub_001',
      userId: 'user_010',
      status: 'active',
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: 'user_010',
    });

    expect(sub).not.toBeNull();
    expect(sub!.stripeSubscriptionId).toBe('sub_001');
    expect(sub!.status).toBe('active');
  });

  it('getTrialStatus: returns trial days remaining', async () => {
    const t = convexTest(schema, modules);

    const trialStart = '2030-01-01T00:00:00.000Z';
    const trialEnd = '2030-01-08T00:00:00.000Z';

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: 'sub_trial_001',
      userId: 'user_trial',
      status: 'trialing',
      cancelAtPeriodEnd: false,
      isTrialing: true,
      trialStart,
      trialEnd,
    });

    const doc = await t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: 'sub_trial_001',
    });

    const trialStatus = await t.query(api.billing.queries.getTrialStatus, {
      subscriptionId: doc!._id,
    });

    expect(trialStatus).not.toBeNull();
    expect(trialStatus!.isTrialing).toBe(true);
    expect(trialStatus!.daysRemaining).toBeGreaterThanOrEqual(6);
    expect(trialStatus!.status).toBe('trialing');
  });
});

describe('billing — checkout session mutations and queries', () => {
  it('upsertCheckoutSession + getCheckoutSessionByStripeId', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: 'cs_001',
      userId: 'user_020',
      mode: 'subscription',
      status: 'open',
    });

    const session = await t.query(
      api.billing.queries.getCheckoutSessionByStripeId,
      {
        stripeSessionId: 'cs_001',
      },
    );

    expect(session).not.toBeNull();
    expect(session!.mode).toBe('subscription');
    expect(session!.status).toBe('open');
  });
});

describe('billing — invoice mutations and queries', () => {
  it('upsertInvoice + listInvoices', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: 'inv_001',
      userId: 'user_030',
      status: 'paid',
      currency: 'usd',
      amountDue: 2000,
      amountPaid: 2000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: 'inv_002',
      userId: 'user_030',
      status: 'open',
      currency: 'usd',
      amountDue: 5000,
      amountPaid: 0,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      userId: 'user_030',
    });

    expect(invoices).toHaveLength(2);
  });
});

describe('core — clearAllTables', () => {
  it('clearAllTables: removes all records', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: 'prod_clear',
      name: 'To Be Cleared',
      active: true,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: 'sub_clear',
      userId: 'user_clear',
      status: 'active',
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const result = await t.mutation(api.core.mutations.clearAllTables, {});

    expect(result.cleared).toBeGreaterThan(0);
    expect(result.tables).toContain('products');
    expect(result.tables).toContain('subscriptions');
  });
});
