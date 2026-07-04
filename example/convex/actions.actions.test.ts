// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Mocked unit coverage for `actions.ts`'s state-changing actions (BTS-83):
 * every subscription-lifecycle, dispute, and refund/reversal action must
 * reject when the caller-claimed `userId` doesn't own the target resource,
 * and every money-moving/dispute-closing action must refuse to run against a
 * non-test-mode `STRIPE_SECRET_KEY` before making any Stripe call.
 *
 * Follows the `adminTesting.actions.test.ts` pattern: `./stripe` (the app's
 * `BetterStripe` singleton) is mocked wholesale so these tests exercise only
 * this app's own action/authz wiring, never a real Stripe call.
 * `issueRefund`/`reverseSaleTransfers` additionally verify ownership against
 * real component ledger rows (payments/transfers) via `convex-test`'s
 * installed component, the same way `fireCheckoutCompleted` does in
 * `adminTesting.actions.test.ts`.
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("./stripe", () => ({
  stripe: {
    getSubscriptionByStripeId: vi.fn(),
    cancelSubscription: vi.fn(),
    reactivateSubscription: vi.fn(),
    pauseSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    updateSubscriptionQuantity: vi.fn(),
    updateSubscriptionPrice: vi.fn(),
    updateSubscriptionTrialEnd: vi.fn(),
    getAccountByUserId: vi.fn(),
    getDisputeByStripeId: vi.fn(),
    updateDispute: vi.fn(),
    closeDispute: vi.fn(),
    createDisputeSession: vi.fn(),
    createRefund: vi.fn(),
    listTransfersByCharge: vi.fn(),
    reverseTransfers: vi.fn(),
    getPriceByStripeId: vi.fn(),
    getProductByStripeId: vi.fn(),
    deactivatePrice: vi.fn(),
  },
}));

import { api, components } from "./_generated/api";
import schema from "./schema";
import { stripe as mockedStripeUntyped } from "./stripe";
// The installed component, loaded from the built output the example resolves
// (same pattern as adminTesting.actions.test.ts/seed.test.ts).
import componentSchema from "../../dist/component/schema.js";

const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");

type MockedStripe = {
  getSubscriptionByStripeId: Mock;
  cancelSubscription: Mock;
  reactivateSubscription: Mock;
  pauseSubscription: Mock;
  resumeSubscription: Mock;
  updateSubscriptionQuantity: Mock;
  updateSubscriptionPrice: Mock;
  updateSubscriptionTrialEnd: Mock;
  getAccountByUserId: Mock;
  getDisputeByStripeId: Mock;
  updateDispute: Mock;
  closeDispute: Mock;
  createDisputeSession: Mock;
  createRefund: Mock;
  listTransfersByCharge: Mock;
  reverseTransfers: Mock;
  getPriceByStripeId: Mock;
  getProductByStripeId: Mock;
  deactivatePrice: Mock;
};
const mockedStripe = mockedStripeUntyped as unknown as MockedStripe;

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}

const TEST_KEY = "sk_test_mock_actions";

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = TEST_KEY;
  vi.clearAllMocks();
});

// =============================================================================
// Subscription lifecycle — wrong-owner rejection (BTS-83, shared helper)
// =============================================================================

const OWNER_SUBSCRIPTION = {
  stripeSubscriptionId: "sub_1",
  userId: "owner_1",
  status: "active",
};

describe("actions — subscription lifecycle wrong-owner rejection (BTS-83)", () => {
  it("cancelSubscription rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.cancelSubscription, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.cancelSubscription).not.toHaveBeenCalled();
  });

  it("cancelSubscription succeeds for the true owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);
    mockedStripe.cancelSubscription.mockResolvedValue({ status: "active" });

    await t.action(api.actions.cancelSubscription, {
      userId: "owner_1",
      stripeSubscriptionId: "sub_1",
    });

    expect(mockedStripe.cancelSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripeSubscriptionId: "sub_1" }),
    );
  });

  it("reactivateSubscription rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.reactivateSubscription, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.reactivateSubscription).not.toHaveBeenCalled();
  });

  it("pauseSubscription rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.pauseSubscription, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.pauseSubscription).not.toHaveBeenCalled();
  });

  it("resumeSubscription rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.resumeSubscription, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.resumeSubscription).not.toHaveBeenCalled();
  });

  it("updateSubscriptionQuantity rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.updateSubscriptionQuantity, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
        quantity: 3,
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.updateSubscriptionQuantity).not.toHaveBeenCalled();
  });

  it("updateSubscriptionPrice rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.updateSubscriptionPrice, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_1",
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.updateSubscriptionPrice).not.toHaveBeenCalled();
  });

  it("rejects a blank userId before any Stripe side effect (formerly lifecycleArgs, BTS-81)", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.cancelSubscription, {
        userId: "",
        stripeSubscriptionId: "sub_1",
      }),
    ).rejects.toThrowError(/userId is required/);
    expect(mockedStripe.getSubscriptionByStripeId).not.toHaveBeenCalled();
  });

  it("rejects a blank stripeSubscriptionId before any Stripe side effect (formerly lifecycleArgs, BTS-81)", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.cancelSubscription, {
        userId: "owner_1",
        stripeSubscriptionId: "",
      }),
    ).rejects.toThrowError(/stripeSubscriptionId is required/);
    expect(mockedStripe.getSubscriptionByStripeId).not.toHaveBeenCalled();
  });

  it("updateSubscriptionTrialEnd rejects a caller who isn't the subscription's owner", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue(OWNER_SUBSCRIPTION);

    await expect(
      t.action(api.actions.updateSubscriptionTrialEnd, {
        userId: "not_the_owner",
        stripeSubscriptionId: "sub_1",
        trialEnd: "now",
      }),
    ).rejects.toThrowError(/Subscription not found for this user/);
    expect(mockedStripe.updateSubscriptionTrialEnd).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Disputes — wrong-owner rejection (BTS-83)
// =============================================================================

const OWNER_ACCOUNT = { stripeAccountId: "acct_owner" };
const OTHER_ACCOUNT = { stripeAccountId: "acct_other" };
const OWNED_DISPUTE = { stripeDisputeId: "dp_1", accountId: "acct_owner" };

function accountFor(ownerUserId: string) {
  return async (_ctx: unknown, args: { userId: string }) =>
    args.userId === ownerUserId ? OWNER_ACCOUNT : OTHER_ACCOUNT;
}

describe("actions — dispute actions wrong-owner rejection (BTS-83)", () => {
  it("acceptDispute rejects a caller who isn't the dispute's owning account (previously had no check at all)", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.getDisputeByStripeId.mockResolvedValue(OWNED_DISPUTE);

    await expect(
      t.action(api.actions.acceptDispute, {
        userId: "not_the_owner",
        stripeDisputeId: "dp_1",
      }),
    ).rejects.toThrowError(/Dispute not found for this account/);
    expect(mockedStripe.closeDispute).not.toHaveBeenCalled();
  });

  it("acceptDispute succeeds for the dispute's true owning account", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.getDisputeByStripeId.mockResolvedValue(OWNED_DISPUTE);
    mockedStripe.closeDispute.mockResolvedValue({ success: true });

    await t.action(api.actions.acceptDispute, {
      userId: "owner_1",
      stripeDisputeId: "dp_1",
    });

    expect(mockedStripe.closeDispute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripeDisputeId: "dp_1",
        stripeAccountId: "acct_owner",
      }),
    );
  });

  it("submitDisputeEvidence rejects a caller who isn't the dispute's owning account", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.getDisputeByStripeId.mockResolvedValue(OWNED_DISPUTE);

    await expect(
      t.action(api.actions.submitDisputeEvidence, {
        userId: "not_the_owner",
        stripeDisputeId: "dp_1",
        evidence: { product_description: "widget" },
        submit: false,
      }),
    ).rejects.toThrowError(/Dispute not found for this account/);
    expect(mockedStripe.updateDispute).not.toHaveBeenCalled();
  });

  it("createDisputeSession rejects a caller requesting a session for an account they don't own", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));

    await expect(
      t.action(api.actions.createDisputeSession, {
        userId: "not_the_owner",
        stripeAccountId: "acct_owner",
      }),
    ).rejects.toThrowError(/Account not found for this user/);
    expect(mockedStripe.createDisputeSession).not.toHaveBeenCalled();
  });

  it("createDisputeSession succeeds when the caller owns the requested account", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.createDisputeSession.mockResolvedValue({
      clientSecret: "cs_test_1",
    });

    await t.action(api.actions.createDisputeSession, {
      userId: "owner_1",
      stripeAccountId: "acct_owner",
    });

    expect(mockedStripe.createDisputeSession).toHaveBeenCalledWith(
      expect.anything(),
      { stripeAccountId: "acct_owner" },
    );
  });
});

// =============================================================================
// Refunds / reversals — wrong-owner rejection (BTS-83), real component rows
// =============================================================================

describe("actions — issueRefund wrong-owner rejection (BTS-83)", () => {
  it("rejects a caller whose account isn't the payment's merchant", async () => {
    const t = withComponent();
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    await t.mutation(components.betterStripe.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_1",
      userId: "",
      accountId: "acct_owner",
      destinationAccountId: "acct_owner",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await expect(
      t.action(api.actions.issueRefund, {
        userId: "not_the_owner",
        stripePaymentIntentId: "pi_1",
        reason: "requested_by_customer",
      }),
    ).rejects.toThrowError(/Payment not found for this account/);
    expect(mockedStripe.createRefund).not.toHaveBeenCalled();
  });

  it("rejects when the caller has no linked Stripe account at all", async () => {
    const t = withComponent();
    mockedStripe.getAccountByUserId.mockResolvedValue(null);
    await t.mutation(components.betterStripe.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_1",
      userId: "",
      accountId: "acct_owner",
      destinationAccountId: "acct_owner",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await expect(
      t.action(api.actions.issueRefund, {
        userId: "no_account_user",
        stripePaymentIntentId: "pi_1",
        reason: "requested_by_customer",
      }),
    ).rejects.toThrowError(/Payment not found for this account/);
    expect(mockedStripe.createRefund).not.toHaveBeenCalled();
  });

  it("succeeds for the payment's true destination-account merchant", async () => {
    const t = withComponent();
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.createRefund.mockResolvedValue({ stripeRefundId: "re_1" });
    await t.mutation(components.betterStripe.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_1",
      userId: "",
      accountId: "acct_owner",
      destinationAccountId: "acct_owner",
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.action(api.actions.issueRefund, {
      userId: "owner_1",
      stripePaymentIntentId: "pi_1",
      reason: "requested_by_customer",
    });

    expect(mockedStripe.createRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripePaymentIntentId: "pi_1",
        stripeAccountId: "acct_owner",
        actor: { type: "seller", accountId: "acct_owner" },
      }),
    );
  });

  it("succeeds for the store leg of a split sale even without a destination account", async () => {
    const t = withComponent();
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("store_owner"));
    mockedStripe.createRefund.mockResolvedValue({ stripeRefundId: "re_2" });
    await t.mutation(components.betterStripe.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_split",
      userId: "",
      accountId: "acct_platform",
      splitRecipients: [
        { destinationAccountId: "acct_owner", role: "store" },
        { destinationAccountId: "acct_affiliate", role: "affiliate" },
      ],
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });

    await t.action(api.actions.issueRefund, {
      userId: "store_owner",
      stripePaymentIntentId: "pi_split",
      reason: "requested_by_customer",
    });

    expect(mockedStripe.createRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripePaymentIntentId: "pi_split" }),
    );
  });

  it("rejects an affiliate (minor split leg) trying to refund the whole sale", async () => {
    const t = withComponent();
    mockedStripe.getAccountByUserId.mockImplementation(
      accountFor("affiliate_owner"),
    );
    await t.mutation(components.betterStripe.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_split_2",
      userId: "",
      accountId: "acct_platform",
      splitRecipients: [
        { destinationAccountId: "acct_owner", role: "store" },
        { destinationAccountId: "acct_affiliate", role: "affiliate" },
      ],
      amount: 1000,
      currency: "usd",
      status: "succeeded",
    });
    // This account is the affiliate leg, not the store leg — reuse
    // `accountFor` but point it at the affiliate's own account id.
    mockedStripe.getAccountByUserId.mockImplementation(async (_ctx, args) =>
      args.userId === "affiliate_owner"
        ? { stripeAccountId: "acct_affiliate" }
        : { stripeAccountId: "acct_other" },
    );

    await expect(
      t.action(api.actions.issueRefund, {
        userId: "affiliate_owner",
        stripePaymentIntentId: "pi_split_2",
        reason: "requested_by_customer",
      }),
    ).rejects.toThrowError(/Payment not found for this account/);
    expect(mockedStripe.createRefund).not.toHaveBeenCalled();
  });
});

describe("actions — reverseSaleTransfers wrong-owner rejection (BTS-83)", () => {
  it("rejects a caller whose account isn't a transfer's destination", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.listTransfersByCharge.mockResolvedValue([
      { stripeTransferId: "tr_1", destinationAccountId: "acct_owner", amount: 1000 },
    ]);

    await expect(
      t.action(api.actions.reverseSaleTransfers, {
        userId: "not_the_owner",
        sourceChargeId: "ch_1",
      }),
    ).rejects.toThrowError(/Charge not found for this account/);
    expect(mockedStripe.reverseTransfers).not.toHaveBeenCalled();
  });

  it("rejects the affiliate leg of a split charge (minor leg can't reverse the whole sale)", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(async (_ctx, args) =>
      args.userId === "affiliate_owner"
        ? { stripeAccountId: "acct_affiliate" }
        : null,
    );
    mockedStripe.listTransfersByCharge.mockResolvedValue([
      { stripeTransferId: "tr_1", destinationAccountId: "acct_owner", role: "store", amount: 800 },
      {
        stripeTransferId: "tr_2",
        destinationAccountId: "acct_affiliate",
        role: "affiliate",
        amount: 200,
      },
    ]);

    await expect(
      t.action(api.actions.reverseSaleTransfers, {
        userId: "affiliate_owner",
        sourceChargeId: "ch_split",
      }),
    ).rejects.toThrowError(/Charge not found for this account/);
    expect(mockedStripe.reverseTransfers).not.toHaveBeenCalled();
  });

  it("succeeds for the charge's destination-account merchant", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.listTransfersByCharge.mockResolvedValue([
      { stripeTransferId: "tr_1", destinationAccountId: "acct_owner", amount: 1000 },
    ]);
    mockedStripe.reverseTransfers.mockResolvedValue({
      reversals: [{ stripeTransferId: "tr_1", amount: 1000 }],
    });

    const result = await t.action(api.actions.reverseSaleTransfers, {
      userId: "owner_1",
      sourceChargeId: "ch_1",
    });

    expect(mockedStripe.reverseTransfers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceChargeId: "ch_1" }),
    );
    expect(result.summary).toEqual({ reversalCount: 1, totalReversed: 1000 });
  });
});

// =============================================================================
// Price deactivation — wrong-owner rejection + happy path (BTS-88)
//
// A `prices` row carries no owner of its own, so ownership resolves one hop up:
// the price's product must belong to the caller's connected account. Because
// `assertPriceOwner` reads price/product through the (mocked) `stripe` client
// rather than component rows, these use plain `convexTest` — no installed
// component needed (unlike `issueRefund`).
// =============================================================================

const OWNED_PRICE = { stripePriceId: "price_1", stripeProductId: "prod_1" };
const OWNED_PRODUCT = { stripeProductId: "prod_1", accountId: "acct_owner" };

describe("actions — deactivatePrice ownership rejection (BTS-88)", () => {
  it("rejects a caller who doesn't own the price's owning product", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.getPriceByStripeId.mockResolvedValue(OWNED_PRICE);
    mockedStripe.getProductByStripeId.mockResolvedValue(OWNED_PRODUCT);

    await expect(
      t.action(api.actions.deactivatePrice, {
        userId: "not_the_owner",
        stripePriceId: "price_1",
      }),
    ).rejects.toThrowError(/Price not found for this account/);
    expect(mockedStripe.deactivatePrice).not.toHaveBeenCalled();
  });

  it("rejects a platform price whose product has no owning account", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.getPriceByStripeId.mockResolvedValue(OWNED_PRICE);
    // Platform-catalog product (created without `accountId`) — owned by no
    // connected account, so even the "owner_1" persona can't claim it.
    mockedStripe.getProductByStripeId.mockResolvedValue({
      stripeProductId: "prod_1",
    });

    await expect(
      t.action(api.actions.deactivatePrice, {
        userId: "owner_1",
        stripePriceId: "price_1",
      }),
    ).rejects.toThrowError(/Price not found for this account/);
    expect(mockedStripe.deactivatePrice).not.toHaveBeenCalled();
  });

  it("rejects when the caller has no linked Stripe account at all", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockResolvedValue(null);
    mockedStripe.getPriceByStripeId.mockResolvedValue(OWNED_PRICE);
    mockedStripe.getProductByStripeId.mockResolvedValue(OWNED_PRODUCT);

    await expect(
      t.action(api.actions.deactivatePrice, {
        userId: "no_account_user",
        stripePriceId: "price_1",
      }),
    ).rejects.toThrowError(/Price not found for this account/);
    expect(mockedStripe.deactivatePrice).not.toHaveBeenCalled();
  });

  it("succeeds for the price's true owning account", async () => {
    const t = convexTest(schema, modules);
    mockedStripe.getAccountByUserId.mockImplementation(accountFor("owner_1"));
    mockedStripe.getPriceByStripeId.mockResolvedValue(OWNED_PRICE);
    mockedStripe.getProductByStripeId.mockResolvedValue(OWNED_PRODUCT);
    mockedStripe.deactivatePrice.mockResolvedValue({ success: true });

    const result = await t.action(api.actions.deactivatePrice, {
      userId: "owner_1",
      stripePriceId: "price_1",
    });

    expect(result).toEqual({ success: true });
    expect(mockedStripe.deactivatePrice).toHaveBeenCalledWith(
      expect.anything(),
      { stripePriceId: "price_1" },
    );
  });
});

// =============================================================================
// Money actions — test-mode key fail-closed guard (BTS-83, shares BTS-77's
// `assertTestModeStripeKey`)
// =============================================================================

describe("actions — refuse a live/misconfigured key before any Stripe call (BTS-83)", () => {
  it("issueRefund throws before checking ownership or calling Stripe when the key is live", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = withComponent();

    await expect(
      t.action(api.actions.issueRefund, {
        userId: "owner_1",
        stripePaymentIntentId: "pi_1",
        reason: "requested_by_customer",
      }),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.getAccountByUserId).not.toHaveBeenCalled();
    expect(mockedStripe.createRefund).not.toHaveBeenCalled();
  });

  it("reverseSaleTransfers throws before checking ownership or calling Stripe when the key is live", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.reverseSaleTransfers, {
        userId: "owner_1",
        sourceChargeId: "ch_1",
      }),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.getAccountByUserId).not.toHaveBeenCalled();
    expect(mockedStripe.reverseTransfers).not.toHaveBeenCalled();
  });

  it("acceptDispute throws before checking ownership or calling Stripe when the key is live", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.acceptDispute, {
        userId: "owner_1",
        stripeDisputeId: "dp_1",
      }),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.getAccountByUserId).not.toHaveBeenCalled();
    expect(mockedStripe.closeDispute).not.toHaveBeenCalled();
  });

  it("submitDisputeEvidence throws before checking ownership or calling Stripe when the key is live (BTS-89)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.submitDisputeEvidence, {
        userId: "owner_1",
        stripeDisputeId: "dp_1",
        evidence: { product_description: "widget" },
        submit: false,
      }),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.getAccountByUserId).not.toHaveBeenCalled();
    expect(mockedStripe.updateDispute).not.toHaveBeenCalled();
  });

  it("createDisputeSession throws before checking ownership or calling Stripe when the key is live (BTS-89)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.createDisputeSession, {
        userId: "owner_1",
        stripeAccountId: "acct_owner",
      }),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.getAccountByUserId).not.toHaveBeenCalled();
    expect(mockedStripe.createDisputeSession).not.toHaveBeenCalled();
  });

  it("deactivatePrice throws before checking ownership or calling Stripe when the key is live (BTS-88)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.actions.deactivatePrice, {
        userId: "owner_1",
        stripePriceId: "price_1",
      }),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.getAccountByUserId).not.toHaveBeenCalled();
    expect(mockedStripe.deactivatePrice).not.toHaveBeenCalled();
  });

  it("issueRefund throws when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const t = withComponent();

    await expect(
      t.action(api.actions.issueRefund, {
        userId: "owner_1",
        stripePaymentIntentId: "pi_1",
        reason: "requested_by_customer",
      }),
    ).rejects.toThrowError(/not set/);
    expect(mockedStripe.createRefund).not.toHaveBeenCalled();
  });
});
