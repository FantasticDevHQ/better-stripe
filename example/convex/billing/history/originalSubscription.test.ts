// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import type {
  StripeComponentAccount,
  StripeComponentSubscription,
} from "@fantastic.dev/better-stripe";
import { modules } from "../../../test.js";
import schema from "../../schema.js";
import { stripe } from "../../stripe/helpers.js";
import { requireOriginalSubscription } from "./originalSubscription.js";

afterEach(() => vi.restoreAllMocks());
const original = {
  stripeAccountId: "acct_original",
  stripeSubscriptionId: "sub_original",
};
async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Buyer",
      email: "buyer@example.invalid",
      role: "buyer",
      authTokenIdentifier: "original_buyer",
    }),
  );
  const account: StripeComponentAccount = {
    _id: "account_component_id",
    _creationTime: 1,
    stripeAccountId: original.stripeAccountId,
    userId,
    onboardingStatus: "complete",
  };
  const subscription: StripeComponentSubscription = {
    _id: "subscription_component_id",
    _creationTime: 1,
    stripeSubscriptionId: original.stripeSubscriptionId,
    userId,
    accountId: original.stripeAccountId,
    status: "canceled",
    cancelAtPeriodEnd: false,
    isTrialing: false,
  };
  const accountRead = vi
    .spyOn(stripe, "getAccountByStripeId")
    .mockResolvedValue(account);
  const subscriptionRead = vi
    .spyOn(stripe, "getSubscriptionByStripeId")
    .mockResolvedValue(subscription);
  const caller = t.withIdentity({
    subject: "original_buyer",
    tokenIdentifier: "original_buyer",
  });
  return { t, caller, account, subscription, accountRead, subscriptionRead };
}

it("authenticates before any private component lookup", async () => {
  const f = await fixture();
  await expect(
    f.t.run((ctx) => requireOriginalSubscription(ctx, original)),
  ).rejects.toThrow("Authentication required");
  expect(f.accountRead).not.toHaveBeenCalled();
  expect(f.subscriptionRead).not.toHaveBeenCalled();
});

it("requests uniqueness for both original IDs and preserves canceled history", async () => {
  const f = await fixture();
  expect(
    await f.caller.run((ctx) => requireOriginalSubscription(ctx, original)),
  ).toEqual({ account: f.account, subscription: f.subscription });
  expect(f.accountRead).toHaveBeenCalledWith(expect.anything(), {
    stripeAccountId: original.stripeAccountId,
    requireUnique: true,
  });
  expect(f.subscriptionRead).toHaveBeenCalledWith(expect.anything(), {
    stripeSubscriptionId: original.stripeSubscriptionId,
    requireUnique: true,
  });
});

it.each([
  "missingAccount",
  "missingSubscription",
  "foreignBuyer",
  "differentAccount",
])("holds %s instead of guessing a replacement", async (failure) => {
  const f = await fixture();
  if (failure === "missingAccount") f.accountRead.mockResolvedValue(null);
  if (failure === "missingSubscription")
    f.subscriptionRead.mockResolvedValue(null);
  if (failure === "foreignBuyer")
    f.subscriptionRead.mockResolvedValue({
      ...f.subscription,
      userId: "foreign",
    });
  if (failure === "differentAccount")
    f.subscriptionRead.mockResolvedValue({
      ...f.subscription,
      accountId: "acct_replacement",
    });
  await expect(
    f.caller.run((ctx) => requireOriginalSubscription(ctx, original)),
  ).rejects.toThrow("Original subscription unavailable");
});
