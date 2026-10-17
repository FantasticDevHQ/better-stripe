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
