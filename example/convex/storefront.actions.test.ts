/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./stripe", () => ({
  stripe: {
    getPriceByStripeId: vi.fn(),
    getProductByStripeId: vi.fn(),
    getAccountByUserId: vi.fn(),
    getAccountByStripeId: vi.fn(),
    createCheckoutSession: vi.fn(),
    resolveFee: vi.fn(() => ({ percent: 2.9, fixed: 30 })),
  },
}));
import { stripe } from "./stripe";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.*s");
const mock = vi.mocked(stripe);
beforeEach(() => {
  vi.clearAllMocks();
  mock.getPriceByStripeId.mockResolvedValue({
    active: true,
    type: "one_time",
    stripeProductId: "prod_store",
    unitAmount: 12900,
    currency: "usd",
  } as never);
  mock.getProductByStripeId.mockResolvedValue({
    active: true,
    accountId: "acct_seller",
    name: "Ceramics",
  } as never);
  mock.getAccountByStripeId.mockResolvedValue({
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: { stripe_transfers: { status: "active" } },
        },
      },
    },
  } as never);
  mock.getAccountByUserId.mockResolvedValue({
    stripeAccountId: "acct_customer",
  } as never);
  mock.createCheckoutSession.mockResolvedValue({
    stripeSessionId: "cs_test",
    clientSecret: "secret",
    url: undefined,
  });
});
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    customer: await ctx.db.insert("users", {
      name: "Customer",
      email: "customer@example.com",
      role: "customer",
    }),
    affiliate: await ctx.db.insert("users", {
      name: "Avery",
      email: "avery@example.com",
      role: "affiliate",
      stripeAccountId: "acct_affiliate",
    }),
    seller: await ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_seller",
      storeName: "Ceramics",
      storePlan: {
        planId: "growth",
        stripeSubscriptionId: "sub_plan",
        status: "active",
        paidThrough: Date.now() + 86400000,
        cancelAtPeriodEnd: false,
      },
    }),
  }));
  return { t, ids };
}
describe("storefront checkout", () => {
  it("routes a real product price to its seller and binds the active customer", async () => {
    const { t, ids } = await setup();
    await t.action(api.actions.createCheckoutSession, {
      userId: ids.customer,
      stripePriceId: "price_store",
      returnUrl: "http://localhost:5173/checkout/status",
    });
    expect(mock.createCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: ids.customer,
        accountId: "acct_customer",
        amount: 12900,
        metadata: expect.objectContaining({
          storeBilling: "sale_v1",
          sellerId: ids.seller,
          planId: "growth",
          affiliateAccountId: "",
        }),
      }),
    );
  });
  it("attributes guest referrals without borrowing a seeded customer identity", async () => {
    const { t } = await setup();
    await t.action(api.actions.createCheckoutSession, {
      stripePriceId: "price_store",
      referralCode: "avery",
      returnUrl: "http://localhost:5173/checkout/status",
    });
    expect(mock.createCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "",
        amount: 12900,
        metadata: expect.objectContaining({
          storeBilling: "sale_v1",
          planId: "growth",
          affiliateAccountId: "acct_affiliate",
        }),
      }),
    );
    expect(mock.getAccountByUserId).not.toHaveBeenCalled();
  });
  it("does not let the affiliate become the customer in its own referral checkout", async () => {
    const { t, ids } = await setup();
    await expect(
      t.action(api.actions.createCheckoutSession, {
        userId: ids.affiliate,
        stripePriceId: "price_store",
        returnUrl: "http://localhost:5173/checkout/status",
      }),
    ).rejects.toThrow(/customer/i);
    expect(mock.createCheckoutSession).not.toHaveBeenCalled();
  });
  it("rejects inactive prices before any Stripe checkout", async () => {
    const { t, ids } = await setup();
    mock.getPriceByStripeId.mockResolvedValue({ active: false } as never);
    await expect(
      t.action(api.actions.createCheckoutSession, {
        userId: ids.customer,
        stripePriceId: "price_store",
        returnUrl: "http://localhost:5173/checkout/status",
      }),
    ).rejects.toThrow(/available/i);
    expect(mock.createCheckoutSession).not.toHaveBeenCalled();
  });
});

it("rejects customer access to seller subscriber lists", async () => {
  const { t, ids } = await setup();
  mock.getPriceByStripeId.mockResolvedValue({ active: true } as never);
  await expect(
    t.query(api.storefront.listStoreSubscriptions, { sellerId: ids.customer }),
  ).rejects.toThrow(/seller/i);
});
