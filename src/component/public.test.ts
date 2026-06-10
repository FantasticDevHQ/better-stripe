// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

describe("core — account mutations and queries", () => {
  it("upsertAccount: inserts new account", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_001",
      userId: "user_001",
      name: "Test Account",
      email: "test@example.com",
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_001",
    });

    expect(account).not.toBeNull();
    expect(account!.stripeAccountId).toBe("acct_001");
    expect(account!.userId).toBe("user_001");
    expect(account!.name).toBe("Test Account");
    expect(account!.onboardingStatus).toBe("pending");
  });

  it("upsertAccount: updates existing account by stripeAccountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_002",
      userId: "user_002",
      name: "Original Name",
    });

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_002",
      userId: "user_002",
      name: "Updated Name",
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_002",
    });

    expect(account).not.toBeNull();
    expect(account!.name).toBe("Updated Name");
  });

  it("getAccountByUserId: returns matching account", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_003",
      userId: "user_003",
      email: "found@example.com",
    });

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_003",
    });

    expect(account).not.toBeNull();
    expect(account!.userId).toBe("user_003");
    expect(account!.email).toBe("found@example.com");
  });

  it("getAccountByUserId: returns null for unknown user", async () => {
    const t = convexTest(schema, modules);

    const account = await t.query(api.core.queries.getAccountByUserId, {
      userId: "user_nonexistent",
    });

    expect(account).toBeNull();
  });

  it("getAccountOnboardingStatus reflects missingRequirements and readiness", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_004",
      userId: "user_004",
      onboardingStatus: "complete",
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_004",
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status).not.toBeNull();
    expect(status!.isReady).toBe(true);
    expect(status!.onboardingStatus).toBe("complete");
    expect(status!.missingRequirements).toEqual([]);
  });
});

describe("products — product and price mutations and queries", () => {
  it("upsertProduct + getProductByStripeId round trip", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_001",
      name: "Pro Plan",
      active: true,
    });

    const product = await t.query(api.products.queries.getProductByStripeId, {
      stripeProductId: "prod_001",
    });

    expect(product).not.toBeNull();
    expect(product!.name).toBe("Pro Plan");
    expect(product!.active).toBe(true);
  });

  it("upsertPrice + listPricesByProduct", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_002",
      name: "Starter Plan",
      active: true,
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_001",
      productId: "internal_prod_002",
      stripeProductId: "prod_002",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "month",
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_002",
      productId: "internal_prod_002",
      stripeProductId: "prod_002",
      unitAmount: 10000,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "year",
    });

    const prices = await t.query(api.products.queries.listPricesByProduct, {
      stripeProductId: "prod_002",
    });

    expect(prices).toHaveLength(2);
  });
});

describe("billing — subscription mutations and queries", () => {
  it("upsertSubscription + getActiveSubscription", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_001",
      userId: "user_010",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_010",
    });

    expect(sub).not.toBeNull();
    expect(sub!.stripeSubscriptionId).toBe("sub_001");
    expect(sub!.status).toBe("active");
  });

  it("getTrialStatus: returns trial days remaining", async () => {
    const t = convexTest(schema, modules);

    const trialStart = "2030-01-01T00:00:00.000Z";
    const trialEnd = "2030-01-08T00:00:00.000Z";

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_trial_001",
      userId: "user_trial",
      status: "trialing",
      cancelAtPeriodEnd: false,
      isTrialing: true,
      trialStart,
      trialEnd,
    });

    const doc = await t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_trial_001",
    });

    const trialStatus = await t.query(api.billing.queries.getTrialStatus, {
      subscriptionId: doc!._id,
    });

    expect(trialStatus).not.toBeNull();
    expect(trialStatus!.isTrialing).toBe(true);
    expect(trialStatus!.daysRemaining).toBeGreaterThanOrEqual(6);
    expect(trialStatus!.status).toBe("trialing");
  });
});

describe("billing — checkout session mutations and queries", () => {
  it("upsertCheckoutSession + getCheckoutSessionByStripeId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_001",
      userId: "user_020",
      mode: "subscription",
      status: "open",
    });

    const session = await t.query(
      api.billing.queries.getCheckoutSessionByStripeId,
      {
        stripeSessionId: "cs_001",
      },
    );

    expect(session).not.toBeNull();
    expect(session!.mode).toBe("subscription");
    expect(session!.status).toBe("open");
  });
});

describe("billing — invoice mutations and queries", () => {
  it("upsertInvoice + listInvoices", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_001",
      userId: "user_030",
      status: "paid",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 2000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_002",
      userId: "user_030",
      status: "open",
      currency: "usd",
      amountDue: 5000,
      amountPaid: 0,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      userId: "user_030",
    });

    expect(invoices).toHaveLength(2);
  });

  it("getInvoiceByStripeId: returns matching invoice", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_by_stripe_001",
      userId: "user_031",
      status: "paid",
      currency: "usd",
      amountDue: 1500,
      amountPaid: 1500,
    });

    const invoice = await t.query(api.billing.queries.getInvoiceByStripeId, {
      stripeInvoiceId: "inv_by_stripe_001",
    });

    expect(invoice).not.toBeNull();
    expect(invoice!.stripeInvoiceId).toBe("inv_by_stripe_001");
    expect(invoice!.userId).toBe("user_031");
    expect(invoice!.amountDue).toBe(1500);
  });

  it("getInvoiceByStripeId: returns null for unknown id", async () => {
    const t = convexTest(schema, modules);

    const invoice = await t.query(api.billing.queries.getInvoiceByStripeId, {
      stripeInvoiceId: "inv_does_not_exist",
    });

    expect(invoice).toBeNull();
  });
});

describe("core — clearAllTables", () => {
  it("clearAllTables: removes all records", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_clear",
      name: "To Be Cleared",
      active: true,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_clear",
      userId: "user_clear",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.webhooks.mutations.insertWebhookEvent, {
      stripeEventId: "evt_clear",
      eventType: "invoice.paid",
    });

    const result = await t.mutation(api.core.mutations.clearAllTables, {});

    expect(result.cleared).toBeGreaterThan(0);
    expect(result.tables).toContain("products");
    expect(result.tables).toContain("subscriptions");
    expect(result.tables).toContain("webhookEvents");

    const event = await t.query(api.webhooks.queries.getWebhookEvent, {
      stripeEventId: "evt_clear",
    });
    expect(event).toBeNull();
  });
});

// =============================================================================
// CORE — additional account queries and mutations
// =============================================================================

describe("core — getAccountByOrgId", () => {
  it("returns account matching orgId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_org_001",
      userId: "user_org_001",
      orgId: "org_001",
      name: "Org Account",
    });

    const account = await t.query(api.core.queries.getAccountByOrgId, {
      orgId: "org_001",
    });

    expect(account).not.toBeNull();
    expect(account!.orgId).toBe("org_001");
    expect(account!.stripeAccountId).toBe("acct_org_001");
  });

  it("returns null for unknown orgId", async () => {
    const t = convexTest(schema, modules);

    const account = await t.query(api.core.queries.getAccountByOrgId, {
      orgId: "org_nonexistent",
    });

    expect(account).toBeNull();
  });
});

describe("core — deleteAccountByStripeId", () => {
  it("deletes existing account and returns true", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_del_001",
      userId: "user_del_001",
    });

    const result = await t.mutation(
      api.core.mutations.deleteAccountByStripeId,
      {
        stripeAccountId: "acct_del_001",
      },
    );

    expect(result).toBe(true);

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_del_001",
    });
    expect(account).toBeNull();
  });

  it("returns false for nonexistent account", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      api.core.mutations.deleteAccountByStripeId,
      {
        stripeAccountId: "acct_nonexistent",
      },
    );

    expect(result).toBe(false);
  });
});

describe("core — upsertAccountInternal", () => {
  it("inserts account with required onboardingStatus", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_int_001",
      userId: "user_int_001",
      onboardingStatus: "in_progress",
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_int_001",
    });

    expect(account).not.toBeNull();
    expect(account!.onboardingStatus).toBe("in_progress");
  });

  it("updates existing account onboardingStatus", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_int_002",
      userId: "user_int_002",
      onboardingStatus: "pending",
    });

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_int_002",
      userId: "user_int_002",
      onboardingStatus: "complete",
      missingRequirements: [],
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_int_002",
    });

    expect(account!.onboardingStatus).toBe("complete");
    expect(account!.missingRequirements).toEqual([]);
  });
});

describe("core — onboarding status edge cases", () => {
  it("getAccountOnboardingStatus returns null for nonexistent account", async () => {
    const t = convexTest(schema, modules);

    // Insert then delete to get a valid but missing ID
    await t.mutation(api.core.mutations.upsertAccount, {
      stripeAccountId: "acct_ghost",
      userId: "user_ghost",
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_ghost",
    });

    await t.mutation(api.core.mutations.deleteAccountByStripeId, {
      stripeAccountId: "acct_ghost",
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status).toBeNull();
  });

  it("incomplete account has isReady false and missingRequirements", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.core.mutations.upsertAccountInternal, {
      stripeAccountId: "acct_incomplete",
      userId: "user_incomplete",
      onboardingStatus: "restricted",
      missingRequirements: ["external_account", "tos_acceptance"],
    });

    const account = await t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_incomplete",
    });

    const status = await t.query(api.core.queries.getAccountOnboardingStatus, {
      accountId: account!._id,
    });

    expect(status!.isReady).toBe(false);
    expect(status!.onboardingStatus).toBe("restricted");
    expect(status!.missingRequirements).toEqual([
      "external_account",
      "tos_acceptance",
    ]);
  });
});

// =============================================================================
// PRODUCTS — additional filter tests
// =============================================================================

describe("products — listProducts with filters", () => {
  it("filters by active status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_active",
      name: "Active Product",
      active: true,
    });

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_inactive",
      name: "Inactive Product",
      active: false,
    });

    const activeProducts = await t.query(api.products.queries.listProducts, {
      active: true,
    });
    const inactiveProducts = await t.query(api.products.queries.listProducts, {
      active: false,
    });

    expect(activeProducts).toHaveLength(1);
    expect(activeProducts[0].name).toBe("Active Product");
    expect(inactiveProducts).toHaveLength(1);
    expect(inactiveProducts[0].name).toBe("Inactive Product");
  });

  it("filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_acct_a",
      name: "Account A Product",
      active: true,
      accountId: "acct_a",
    });

    await t.mutation(api.products.mutations.upsertProduct, {
      stripeProductId: "prod_acct_b",
      name: "Account B Product",
      active: true,
      accountId: "acct_b",
    });

    const products = await t.query(api.products.queries.listProducts, {
      accountId: "acct_a",
    });

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Account A Product");
  });
});

describe("products — price queries", () => {
  it("getPriceByStripeId round trip", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_lookup",
      productId: "internal_prod",
      stripeProductId: "prod_lookup",
      unitAmount: 5000,
      currency: "eur",
      active: true,
      type: "one_time",
    });

    const price = await t.query(api.products.queries.getPriceByStripeId, {
      stripePriceId: "price_lookup",
    });

    expect(price).not.toBeNull();
    expect(price!.unitAmount).toBe(5000);
    expect(price!.currency).toBe("eur");
    expect(price!.type).toBe("one_time");
  });

  it("listPrices filters by active", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_active",
      productId: "prod_x",
      stripeProductId: "prod_x",
      unitAmount: 100,
      currency: "usd",
      active: true,
      type: "one_time",
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_archived",
      productId: "prod_x",
      stripeProductId: "prod_x",
      unitAmount: 200,
      currency: "usd",
      active: false,
      type: "one_time",
    });

    const activePrices = await t.query(api.products.queries.listPrices, {
      active: true,
    });
    expect(activePrices).toHaveLength(1);
    expect(activePrices[0].stripePriceId).toBe("price_active");
  });

  it("upsertPrice updates existing price", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_upd",
      productId: "prod_u",
      stripeProductId: "prod_u",
      unitAmount: 1000,
      currency: "usd",
      active: true,
      type: "recurring",
      interval: "month",
    });

    await t.mutation(api.products.mutations.upsertPrice, {
      stripePriceId: "price_upd",
      productId: "prod_u",
      stripeProductId: "prod_u",
      unitAmount: 1000,
      currency: "usd",
      active: false,
      type: "recurring",
      interval: "month",
    });

    const price = await t.query(api.products.queries.getPriceByStripeId, {
      stripePriceId: "price_upd",
    });

    expect(price!.active).toBe(false);
  });
});

// =============================================================================
// BILLING — additional subscription query tests
// =============================================================================

describe("billing — listSubscriptions with filters", () => {
  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_active",
      userId: "user_a",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_canceled",
      userId: "user_b",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const active = await t.query(api.billing.queries.listSubscriptions, {
      status: "active",
    });
    const canceled = await t.query(api.billing.queries.listSubscriptions, {
      status: "canceled",
    });

    expect(active).toHaveLength(1);
    expect(active[0].stripeSubscriptionId).toBe("sub_active");
    expect(canceled).toHaveLength(1);
    expect(canceled[0].stripeSubscriptionId).toBe("sub_canceled");
  });

  it("rejects an invalid status with a validation error", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.billing.queries.listSubscriptions, {
        // @ts-expect-error — invalid status must be rejected by the validator
        status: "not_a_real_status",
      }),
    ).rejects.toThrow(/Validator error/);
  });

  it("respects limit", async () => {
    const t = convexTest(schema, modules);

    for (let i = 0; i < 5; i++) {
      await t.mutation(api.billing.mutations.upsertSubscription, {
        stripeSubscriptionId: `sub_limit_${i}`,
        userId: `user_limit_${i}`,
        status: "active",
        cancelAtPeriodEnd: false,
        isTrialing: false,
      });
    }

    const limited = await t.query(api.billing.queries.listSubscriptions, {
      limit: 2,
    });

    expect(limited).toHaveLength(2);
  });

  it("filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_acct_a1",
      accountId: "acct_sub_a",
      userId: "user_sub_acct_a",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_acct_a2",
      accountId: "acct_sub_a",
      userId: "user_sub_acct_a",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_acct_b1",
      accountId: "acct_sub_b",
      userId: "user_sub_acct_b",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const subs = await t.query(api.billing.queries.listSubscriptions, {
      accountId: "acct_sub_a",
    });

    expect(subs).toHaveLength(2);
    for (const sub of subs) {
      expect(sub.accountId).toBe("acct_sub_a");
    }

    const statusFiltered = await t.query(
      api.billing.queries.listSubscriptions,
      {
        accountId: "acct_sub_a",
        status: "active",
      },
    );

    expect(statusFiltered).toHaveLength(1);
    expect(statusFiltered[0].stripeSubscriptionId).toBe("sub_acct_a1");
  });
});

describe("billing — listSubscriptionsByOrg", () => {
  it("returns subscriptions for the given org", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_a",
      userId: "user_org_a",
      orgId: "org_a",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_b",
      userId: "user_org_b",
      orgId: "org_b",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const orgASubs = await t.query(api.billing.queries.listSubscriptionsByOrg, {
      orgId: "org_a",
    });

    expect(orgASubs).toHaveLength(1);
    expect(orgASubs[0].stripeSubscriptionId).toBe("sub_org_a");
  });

  it("filters by status within org", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_active",
      userId: "user_x",
      orgId: "org_x",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_canceled",
      userId: "user_x",
      orgId: "org_x",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const active = await t.query(api.billing.queries.listSubscriptionsByOrg, {
      orgId: "org_x",
      status: "active",
    });

    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("active");
  });
});

describe("billing — getActiveSubscription with orgId", () => {
  it("finds active subscription by orgId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_org_act",
      userId: "user_oa",
      orgId: "org_act",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_oa",
      orgId: "org_act",
    });

    expect(sub).not.toBeNull();
    expect(sub!.stripeSubscriptionId).toBe("sub_org_act");
  });

  it("finds trialing subscription as active", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_trial_act",
      userId: "user_trial_act",
      status: "trialing",
      cancelAtPeriodEnd: false,
      isTrialing: true,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_trial_act",
    });

    expect(sub).not.toBeNull();
    expect(sub!.status).toBe("trialing");
  });

  it("returns null when no active subscription exists", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_canceled_only",
      userId: "user_canceled",
      status: "canceled",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const sub = await t.query(api.billing.queries.getActiveSubscription, {
      userId: "user_canceled",
    });

    expect(sub).toBeNull();
  });
});

describe("billing — listCheckoutSessionsByUser", () => {
  it("lists sessions for the given user", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_u1_a",
      userId: "user_cs_1",
      mode: "subscription",
      status: "complete",
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_u1_b",
      userId: "user_cs_1",
      mode: "payment",
      status: "open",
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_u2",
      userId: "user_cs_2",
      mode: "subscription",
      status: "open",
    });

    const sessions = await t.query(
      api.billing.queries.listCheckoutSessionsByUser,
      { userId: "user_cs_1" },
    );

    expect(sessions).toHaveLength(2);
  });

  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_filter_open",
      userId: "user_filter",
      mode: "subscription",
      status: "open",
    });

    await t.mutation(api.billing.mutations.upsertCheckoutSession, {
      stripeSessionId: "cs_filter_complete",
      userId: "user_filter",
      mode: "subscription",
      status: "complete",
    });

    const open = await t.query(api.billing.queries.listCheckoutSessionsByUser, {
      userId: "user_filter",
      status: "open",
    });

    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("open");
  });
});

describe("billing — listInvoices with filters", () => {
  it("filters by subscriptionId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_sub_a",
      userId: "user_inv",
      subscriptionId: "sub_inv_a",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_sub_b",
      userId: "user_inv",
      subscriptionId: "sub_inv_b",
      status: "paid",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 2000,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      subscriptionId: "sub_inv_a",
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0].stripeInvoiceId).toBe("inv_sub_a");
  });

  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_st_paid",
      userId: "user_st",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_st_open",
      userId: "user_st",
      status: "open",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 0,
    });

    const paidOnly = await t.query(api.billing.queries.listInvoices, {
      userId: "user_st",
      status: "paid",
    });

    expect(paidOnly).toHaveLength(1);
    expect(paidOnly[0].status).toBe("paid");
  });

  it("filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_acct_a1",
      userId: "user_acct_a",
      accountId: "acct_inv_a",
      status: "paid",
      currency: "usd",
      amountDue: 1000,
      amountPaid: 1000,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_acct_a2",
      userId: "user_acct_a",
      accountId: "acct_inv_a",
      status: "open",
      currency: "usd",
      amountDue: 2000,
      amountPaid: 0,
    });

    await t.mutation(api.billing.mutations.upsertInvoice, {
      stripeInvoiceId: "inv_acct_b1",
      userId: "user_acct_b",
      accountId: "acct_inv_b",
      status: "paid",
      currency: "usd",
      amountDue: 3000,
      amountPaid: 3000,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      accountId: "acct_inv_a",
    });

    expect(invoices).toHaveLength(2);
    for (const invoice of invoices) {
      expect(invoice.accountId).toBe("acct_inv_a");
    }

    const statusFiltered = await t.query(api.billing.queries.listInvoices, {
      accountId: "acct_inv_a",
      status: "paid",
    });

    expect(statusFiltered).toHaveLength(1);
    expect(statusFiltered[0].stripeInvoiceId).toBe("inv_acct_a1");
  });
});

describe("billing — subscription backfills orphaned invoices", () => {
  it("upsertSubscription patches orphaned invoices with userId", async () => {
    const t = convexTest(schema, modules);

    // Insert an invoice linked to a subscription but without userId
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        stripeInvoiceId: "inv_orphan",
        userId: "",
        subscriptionId: "sub_backfill",
        status: "paid",
        currency: "usd",
        amountDue: 3000,
        amountPaid: 3000,
      });
    });

    // Now upsert the subscription — should backfill the invoice
    await t.mutation(api.billing.mutations.upsertSubscription, {
      stripeSubscriptionId: "sub_backfill",
      userId: "user_backfill",
      status: "active",
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });

    const invoices = await t.query(api.billing.queries.listInvoices, {
      userId: "user_backfill",
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0].stripeInvoiceId).toBe("inv_orphan");
  });
});

// =============================================================================
// CONNECT — payment and payout mutations and queries
// =============================================================================

describe("connect — payment mutations and queries", () => {
  it("upsertPayment inserts new payment", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_001",
      userId: "user_pay_001",
      amount: 5000,
      currency: "usd",
      status: "succeeded",
    });

    const payments = await t.run(async (ctx) => {
      return await ctx.db.query("payments").collect();
    });

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      stripePaymentIntentId: "pi_001",
      amount: 5000,
      status: "succeeded",
    });
  });

  it("upsertPayment updates existing payment by stripePaymentIntentId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_002",
      userId: "user_pay_002",
      amount: 3000,
      currency: "usd",
      status: "processing",
    });

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_002",
      userId: "user_pay_002",
      amount: 3000,
      currency: "usd",
      status: "succeeded",
    });

    const payments = await t.run(async (ctx) => {
      return await ctx.db.query("payments").collect();
    });

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("succeeded");
  });

  it("getPaymentByStripeId: returns matching payment", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_by_stripe_001",
      userId: "user_pay_003",
      amount: 4200,
      currency: "usd",
      status: "succeeded",
    });

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_by_stripe_001",
    });

    expect(payment).not.toBeNull();
    expect(payment!.stripePaymentIntentId).toBe("pi_by_stripe_001");
    expect(payment!.userId).toBe("user_pay_003");
    expect(payment!.amount).toBe(4200);
  });

  it("getPaymentByStripeId: returns null for unknown id", async () => {
    const t = convexTest(schema, modules);

    const payment = await t.query(api.connect.queries.getPaymentByStripeId, {
      stripePaymentIntentId: "pi_does_not_exist",
    });

    expect(payment).toBeNull();
  });
});

describe("connect — payout mutations and queries", () => {
  it("upsertPayout + getPayout round trip", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_001",
      accountId: "acct_po_001",
      amount: 10000,
      currency: "usd",
      status: "pending",
    });

    const payouts = await t.run(async (ctx) => {
      return await ctx.db.query("payouts").collect();
    });

    expect(payouts).toHaveLength(1);

    const payout = await t.query(api.connect.queries.getPayout, {
      payoutId: payouts[0]._id,
    });

    expect(payout).toMatchObject({
      stripePayoutId: "po_001",
      amount: 10000,
      status: "pending",
    });
  });

  it("upsertPayout updates existing payout", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_002",
      accountId: "acct_po_002",
      amount: 7500,
      currency: "usd",
      status: "pending",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_002",
      accountId: "acct_po_002",
      amount: 7500,
      currency: "usd",
      status: "paid",
      arrivalDate: "2030-01-15",
    });

    const payouts = await t.run(async (ctx) => {
      return await ctx.db.query("payouts").collect();
    });

    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe("paid");
    expect(payouts[0].arrivalDate).toBe("2030-01-15");
  });

  it("listPayouts: filters by accountId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_acct_a",
      accountId: "acct_a",
      amount: 1000,
      currency: "usd",
      status: "paid",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_acct_b",
      accountId: "acct_b",
      amount: 2000,
      currency: "usd",
      status: "paid",
    });

    const payouts = await t.query(api.connect.queries.listPayouts, {
      accountId: "acct_a",
    });

    expect(payouts).toHaveLength(1);
    expect(payouts[0].stripePayoutId).toBe("po_acct_a");
  });

  it("listPayouts: filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_pending",
      accountId: "acct_st",
      amount: 500,
      currency: "usd",
      status: "pending",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_paid",
      accountId: "acct_st",
      amount: 1500,
      currency: "usd",
      status: "paid",
    });

    const pending = await t.query(api.connect.queries.listPayouts, {
      status: "pending",
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].stripePayoutId).toBe("po_pending");
  });

  it("listPayouts: returns all when no filter", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_all_1",
      accountId: "acct_all",
      amount: 100,
      currency: "usd",
      status: "pending",
    });

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_all_2",
      accountId: "acct_all",
      amount: 200,
      currency: "eur",
      status: "paid",
    });

    const all = await t.query(api.connect.queries.listPayouts, {});

    expect(all).toHaveLength(2);
  });

  it("getPayoutByStripeId: returns matching payout", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.connect.mutations.upsertPayout, {
      stripePayoutId: "po_by_stripe_001",
      accountId: "acct_po_stripe",
      amount: 8800,
      currency: "usd",
      status: "paid",
    });

    const payout = await t.query(api.connect.queries.getPayoutByStripeId, {
      stripePayoutId: "po_by_stripe_001",
    });

    expect(payout).not.toBeNull();
    expect(payout!.stripePayoutId).toBe("po_by_stripe_001");
    expect(payout!.accountId).toBe("acct_po_stripe");
    expect(payout!.amount).toBe(8800);
  });

  it("getPayoutByStripeId: returns null for unknown id", async () => {
    const t = convexTest(schema, modules);

    const payout = await t.query(api.connect.queries.getPayoutByStripeId, {
      stripePayoutId: "po_does_not_exist",
    });

    expect(payout).toBeNull();
  });
});

// =============================================================================
// WEBHOOKS — listWebhookEvents with filters
// =============================================================================

describe("webhooks — listWebhookEvents", () => {
  it("returns all events in descending order", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_list_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now() - 1000,
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_list_2",
        eventType: "checkout.session.completed",
        status: "processed",
        processedAt: Date.now(),
      });
    });

    const events = await t.query(api.webhooks.queries.listWebhookEvents, {});

    expect(events).toHaveLength(2);
    // Most recent first
    expect(events[0].stripeEventId).toBe("evt_list_2");
  });

  it("filters by eventType", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_type_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_type_2",
        eventType: "checkout.session.completed",
        status: "processed",
        processedAt: Date.now(),
      });
    });

    const invoiceEvents = await t.query(
      api.webhooks.queries.listWebhookEvents,
      {
        eventType: "invoice.paid",
      },
    );

    expect(invoiceEvents).toHaveLength(1);
    expect(invoiceEvents[0].eventType).toBe("invoice.paid");
  });

  it("filters by status", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_st_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_st_2",
        eventType: "invoice.paid",
        status: "failed",
        processedAt: Date.now(),
        lastError: "Something went wrong",
      });
    });

    const failed = await t.query(api.webhooks.queries.listWebhookEvents, {
      status: "failed",
    });

    expect(failed).toHaveLength(1);
    expect(failed[0].stripeEventId).toBe("evt_st_2");
  });

  it("combines eventType and status filters", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_combo_1",
        eventType: "invoice.paid",
        status: "processed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_combo_2",
        eventType: "invoice.paid",
        status: "failed",
        processedAt: Date.now(),
      });
      await ctx.db.insert("webhookEvents", {
        stripeEventId: "evt_combo_3",
        eventType: "checkout.session.completed",
        status: "failed",
        processedAt: Date.now(),
      });
    });

    const result = await t.query(api.webhooks.queries.listWebhookEvents, {
      eventType: "invoice.paid",
      status: "failed",
    });

    expect(result).toHaveLength(1);
    expect(result[0].stripeEventId).toBe("evt_combo_2");
  });
});
