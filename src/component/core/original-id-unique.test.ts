// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { schema, modules } from "../../test.js";

async function fixture(duplicate = false) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const account = {
      stripeAccountId: "acct_original_history",
      userId: "original_buyer",
      onboardingStatus: "complete" as const,
    };
    const subscription = {
      stripeSubscriptionId: "sub_original_history",
      userId: "original_buyer",
      accountId: account.stripeAccountId,
      status: "canceled" as const,
      isTrialing: false,
      cancelAtPeriodEnd: false,
    };
    const accountId = await ctx.db.insert("accounts", account);
    const subscriptionId = await ctx.db.insert("subscriptions", subscription);
    if (duplicate) {
      await ctx.db.insert("accounts", {
        ...account,
        userId: "foreign_buyer",
      });
      await ctx.db.insert("subscriptions", {
        ...subscription,
        userId: "foreign_buyer",
        status: "active",
      });
    }
    return { accountId, subscriptionId };
  });
  return { t, ...ids };
}

it("retains existing unique original account and historical subscription reads", async () => {
  const f = await fixture();
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_original_history",
    }),
  ).toMatchObject({ _id: f.accountId, userId: "original_buyer" });
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_original_history",
    }),
  ).toMatchObject({ _id: f.subscriptionId, status: "canceled" });
});

it("preserves legacy first-row defaults when duplicate original provider IDs exist", async () => {
  const f = await fixture(true);
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_original_history",
    }),
  ).toMatchObject({ _id: f.accountId });
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_original_history",
    }),
  ).toMatchObject({ _id: f.subscriptionId });
});

it("returns null instead of selecting the first duplicate original Stripe account ID when uniqueness is required", async () => {
  const f = await fixture(true);
  const args = {
    stripeAccountId: "acct_original_history",
    requireUnique: true,
  };
  await expect(
    f.t.query(api.core.queries.getAccountByStripeId, args),
  ).resolves.toBeNull();
});

it("returns null instead of selecting the first duplicate original Stripe subscription ID when uniqueness is required", async () => {
  const f = await fixture(true);
  const args = {
    stripeSubscriptionId: "sub_original_history",
    requireUnique: true,
  };
  await expect(
    f.t.query(api.billing.queries.getSubscriptionByStripeId, args),
  ).resolves.toBeNull();
});

it("returns null for absent original IDs when uniqueness is required", async () => {
  const f = await fixture();
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_missing",
      requireUnique: true,
    }),
  ).toBeNull();
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_missing",
      requireUnique: true,
    }),
  ).toBeNull();
});

it("returns the unchanged sole original documents when uniqueness is required", async () => {
  const f = await fixture();
  const account = await f.t.query(api.core.queries.getAccount, {
    accountId: f.accountId,
  });
  const subscription = await f.t.query(api.billing.queries.getSubscription, {
    subscriptionId: f.subscriptionId,
  });
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_original_history",
      requireUnique: true,
    }),
  ).toEqual(account);
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_original_history",
      requireUnique: true,
    }),
  ).toEqual(subscription);
});

it("preserves explicit false legacy first-row behavior for duplicate IDs", async () => {
  const f = await fixture(true);
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_original_history",
      requireUnique: false,
    }),
  ).toMatchObject({ _id: f.accountId });
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_original_history",
      requireUnique: false,
    }),
  ).toMatchObject({ _id: f.subscriptionId });
});

it("holds global duplicates even when only one belongs to the original buyer or organization", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.insert("accounts", {
      stripeAccountId: "acct_original_history",
      orgId: "foreign_org",
      userId: "foreign_org_buyer",
      onboardingStatus: "pending",
    });
    await ctx.db.insert("subscriptions", {
      stripeSubscriptionId: "sub_original_history",
      orgId: "foreign_org",
      userId: "foreign_org_buyer",
      accountId: "acct_foreign",
      status: "incomplete",
      isTrialing: false,
      cancelAtPeriodEnd: false,
    });
  });
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_original_history",
      requireUnique: true,
    }),
  ).toBeNull();
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_original_history",
      requireUnique: true,
    }),
  ).toBeNull();
});

it("retains a unique closed original account instead of substituting its current replacement", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.insert("accountClosures", {
      stripeAccountId: "acct_original_history",
      userId: "original_buyer",
      appliedConfigurations: [],
      state: "closed",
      closedAt: 1,
    });
    await ctx.db.insert("accounts", {
      stripeAccountId: "acct_replacement",
      userId: "original_buyer",
      onboardingStatus: "complete",
    });
  });
  expect(
    await f.t.query(api.core.queries.getAccountByStripeId, {
      stripeAccountId: "acct_original_history",
      requireUnique: true,
    }),
  ).toMatchObject({
    _id: f.accountId,
    stripeAccountId: "acct_original_history",
  });
  expect(
    await f.t.query(api.billing.queries.getSubscriptionByStripeId, {
      stripeSubscriptionId: "sub_original_history",
      requireUnique: true,
    }),
  ).toMatchObject({ _id: f.subscriptionId, status: "canceled" });
});
