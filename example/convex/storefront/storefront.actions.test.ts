import { modules } from "../../test";
const intentRaw = vi.hoisted(() => ({ paymentIntents: { create: vi.fn() } }));
vi.mock("../stripe/client", () => ({ getStripeClient: () => intentRaw }));
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import componentSchema from "../../../dist/component/schema.js";
import { api, components } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";
vi.mock("../stripe/helpers", () => ({
  stripe: {
    getPriceByStripeId: vi.fn(),
    getProductByStripeId: vi.fn(),
    getAccountByUserId: vi.fn(),
    getAccountByStripeId: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPaymentIntent: vi.fn(),
    resolveFee: vi.fn(() => ({ percent: 2.9, fixed: 30 })),
  },
}));
const mock = vi.mocked(stripe);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  mock.createPaymentIntent.mockResolvedValue({
    paymentIntentId: "pi_store",
    clientSecret: "test_client_secret",
  });
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
  t.registerComponent(
    "betterStripe",
    componentSchema,
    import.meta.glob("../../../dist/component/**/*.js"),
  );
  await t.mutation(components.betterStripe.products.mutations.upsertProduct, {
    stripeProductId: "prod_store",
    name: "Ceramics",
    active: true,
    accountId: "acct_seller",
  });
  await t.mutation(components.betterStripe.products.mutations.upsertPrice, {
    stripePriceId: "price_store",
    stripeProductId: "prod_store",
    productId: "product",
    active: true,
    type: "one_time",
    unitAmount: 12900,
    currency: "usd",
  });
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
    await t.action(api.billing.public.actions.createCheckoutSession, {
      requestId: "order-retry-123",
      userId: ids.customer,
      stripePriceId: "price_store",
      returnUrl: "http://localhost:5173/checkout/status",
    });
    expect(mock.createCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `example_checkout_${ids.customer}_price_store_embedded_order-retry-123`,
        userId: ids.customer,
        accountId: "acct_customer",
        amount: 12900,
        metadata: expect.objectContaining({
          storeBilling: "sale_v1",
          stripeProductId: "prod_store",
          stripePriceId: "price_store",
          sellerId: ids.seller,
          planId: "growth",
          affiliateAccountId: "",
        }),
      }),
    );
  });
  it("attributes guest referrals without borrowing a seeded customer identity", async () => {
    const { t } = await setup();
    await t.action(api.billing.public.actions.createCheckoutSession, {
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
          stripeProductId: "prod_store",
          stripePriceId: "price_store",
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
      t.action(api.billing.public.actions.createCheckoutSession, {
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
      t.action(api.billing.public.actions.createCheckoutSession, {
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
    t.query(api.storefront.public.queries.listStoreSubscriptions, {
      sellerId: ids.customer,
    }),
  ).rejects.toThrow(/seller/i);
});

it("creates Payment Intents from server prices with the same referral settlement metadata", async () => {
  const { t, ids } = await setup();
  await t.action(api.checkoutExamples.actions.createPaymentIntent, {
    userId: ids.customer,
    stripePriceId: "price_store",
    referralCode: "avery",
    requestId: "checkout-request-123",
  });
  expect(mock.createPaymentIntent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      customerAccount: "acct_customer",
      stripePriceId: "price_store",
      idempotencyKey: `example_pi_${ids.customer}_price_store_checkout-request-123`,
      metadata: expect.objectContaining({
        storeBilling: "sale_v1",
        stripeProductId: "prod_store",
        stripePriceId: "price_store",
        sellerId: ids.seller,
        userId: ids.customer,
        affiliateAccountId: "acct_affiliate",
      }),
    }),
  );
});
it("rejects recurring prices for the one-time Payment Intent example", async () => {
  const { t } = await setup();
  mock.getPriceByStripeId.mockResolvedValue({
    active: true,
    type: "recurring",
    stripeProductId: "prod_store",
    unitAmount: 12900,
    currency: "usd",
  } as never);
  await expect(
    t.action(api.checkoutExamples.actions.createPaymentIntent, {
      stripePriceId: "price_store",
      requestId: "checkout-request-123",
    }),
  ).rejects.toThrow(/one-time/);
  expect(intentRaw.paymentIntents.create).not.toHaveBeenCalled();
});

it("snapshots the inherited commission term into subscription checkout metadata", async () => {
  const { t, ids } = await setup();
  await t.mutation(api.sellerAffiliateRates.public.mutations.save, {
    sellerId: ids.seller,
    stripeProductId: "prod_store",
    stripePriceId: "price_store",
    affiliateBasisPoints: 1000,
    affiliateCommissionTerm: "one_time",
    expectedVersion: 0,
  });
  mock.getPriceByStripeId.mockResolvedValue({
    active: true,
    type: "recurring",
    stripeProductId: "prod_store",
    unitAmount: 12900,
    currency: "usd",
  } as never);
  await t.action(api.billing.public.actions.createCheckoutSession, {
    stripePriceId: "price_store",
    referralCode: "avery",
    returnUrl: "http://localhost:5173/checkout/status",
  });
  expect(mock.createCheckoutSession).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      mode: "subscription",
      metadata: expect.objectContaining({
        affiliateCommissionTerm: "one_time",
        affiliateAccountId: "acct_affiliate",
      }),
    }),
  );
});
it("does not sell a metered product's base price without its original usage subscription", async () => {
  const { t, ids } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("meteredProductOffers", {
      ownerId: ids.seller,
      productId: "prod_store",
      productName: "Coaching",
      configurationJson: "{}",
      baseAmount: 12900,
      createdAt: Date.now(),
      providerJson: JSON.stringify({
        basePriceId: "price_store",
        price: { stripePriceId: "price_usage" },
      }),
    }),
  );
  await expect(
    t.action(api.billing.public.actions.createCheckoutSession, {
      userId: ids.customer,
      stripePriceId: "price_store",
      requestId: "metered-bypass-123",
      returnUrl: "http://localhost:4319/checkout/status",
    }),
  ).rejects.toThrow(/metered product enrollment/);
  expect(mock.createCheckoutSession).not.toHaveBeenCalled();
});
