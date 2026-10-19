import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modules } from "../../test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { productConfiguration } from "./policy";
const mocks = vi.hoisted(() => ({
  stripe: {
    getProductIdentity: vi.fn(),
    ensureUsageMeter: vi.fn(),
    ensureUsagePrice: vi.fn(),
    ensurePrice: vi.fn(),
    getAccountByStripeId: vi.fn(),
    addCustomerConfiguration: vi.fn(),
    usage: { ensureCheckout: vi.fn() },
  },
  raw: {
    accounts: { retrieve: vi.fn() },
    products: { retrieve: vi.fn() },
    prices: { retrieve: vi.fn() },
    customers: { retrieve: vi.fn() },
  },
}));
vi.mock("../stripe/helpers", () => ({ stripe: mocks.stripe }));
vi.mock("../stripe/client", () => ({ getStripeClient: () => mocks.raw }));
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_demo_only");
  mocks.stripe.getProductIdentity.mockResolvedValue({
    status: "unique",
    product: {
      stripeProductId: "prod_coaching",
      name: "Coaching",
      active: true,
      accountId: "acct_maya",
    },
  });
  mocks.raw.accounts.retrieve.mockResolvedValue({ id: "acct_platform" });
  mocks.raw.products.retrieve.mockResolvedValue({
    id: "prod_coaching",
    active: true,
    livemode: false,
  });
  mocks.stripe.ensureUsageMeter.mockResolvedValue({ id: "mtr_coaching" });
  mocks.stripe.ensureUsagePrice.mockResolvedValue({
    stripePriceId: "price_usage",
    meterId: "mtr_coaching",
    currency: "usd",
  });
  mocks.stripe.ensurePrice.mockResolvedValue({ stripePriceId: "price_base" });
  mocks.raw.prices.retrieve.mockResolvedValue({
    product: "prod_coaching",
    active: true,
    livemode: false,
    unit_amount: 2000,
    currency: "usd",
    recurring: { usage_type: "licensed", interval: "month", interval_count: 1 },
  });
  mocks.stripe.getAccountByStripeId.mockResolvedValue({
    userId: "buyer-public",
  });
  mocks.raw.customers.retrieve.mockResolvedValue({
    id: "cus_buyer",
    customer_account: "acct_buyer",
    livemode: false,
  });
  mocks.stripe.usage.ensureCheckout.mockResolvedValue({
    checkoutId: "cs_original",
    status: "open",
    url: "https://checkout.stripe.com/test-only",
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    actorId: await ctx.db.insert("users", {
      name: "Maya",
      email: "maya@example.com",
      role: "seller",
      stripeAccountId: "acct_maya",
    }),
    buyerId: await ctx.db.insert("users", {
      name: "Buyer",
      email: "buyer@example.com",
      role: "customer",
      stripeAccountId: "acct_buyer",
    }),
  }));
  mocks.stripe.getAccountByStripeId.mockResolvedValue({ userId: ids.buyerId });
  return {
    t,
    ...ids,
    productId: "prod_coaching",
    baseAmount: 2000,
    configurationJson: JSON.stringify(
      productConfiguration("included_overage", "Coaching"),
    ),
  };
}
it("provisions and pins original native product terms once, then enrolls the server-linked payer with both prices", async () => {
  const { t, buyerId, ...args } = await fixture();
  const offerId = await t.action(api.meteredProducts.native.configure, args);
  expect(await t.action(api.meteredProducts.native.configure, args)).toBe(
    offerId,
  );
  expect(mocks.stripe.ensureUsageMeter).toHaveBeenCalledTimes(1);
  expect(mocks.stripe.ensurePrice).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      stripeProductId: "prod_coaching",
      unitAmount: 2000,
      lookupKey: `bs_product_${offerId}_base`,
    }),
  );
  const first = JSON.parse(
    await t.action(api.meteredProducts.native.checkout, {
      actorId: buyerId,
      offerId,
    }),
  );
  const second = JSON.parse(
    await t.action(api.meteredProducts.native.checkout, {
      actorId: buyerId,
      offerId,
    }),
  );
  expect(second.enrollmentId).toBe(first.enrollmentId);
  expect(mocks.stripe.addCustomerConfiguration).toHaveBeenCalledTimes(1);
  expect(mocks.stripe.usage.ensureCheckout).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      requestId: `product_${first.enrollmentId}`,
      fixedPriceIds: ["price_base"],
      meters: [
        expect.objectContaining({
          scope: expect.objectContaining({ customerAccount: "acct_buyer" }),
          binding: expect.objectContaining({
            stripeCustomerId: "cus_buyer",
            stripePriceId: "price_usage",
          }),
        }),
      ],
    }),
    expect.anything(),
  );
  const saved = await t.query(internal.meteredProducts.enrollments.read, {
    actorId: buyerId,
    enrollmentId: first.enrollmentId,
  });
  expect(JSON.parse(saved.checkoutJson!).id).toBe("cs_original");
  expect(JSON.parse(saved.payerJson!)).toEqual({
    accountId: "acct_buyer",
    customerId: "cus_buyer",
  });
});
it("retains an uncompleted configuration intent when native base terms disagree", async () => {
  const { t, buyerId: _buyer, ...args } = await fixture();
  void _buyer;
  mocks.raw.prices.retrieve.mockResolvedValue({
    product: "prod_other",
    active: true,
    livemode: false,
    unit_amount: 2000,
    currency: "usd",
    recurring: { usage_type: "licensed", interval: "month", interval_count: 1 },
  });
  await expect(
    t.action(api.meteredProducts.native.configure, args),
  ).rejects.toThrow(/base price/i);
  const rows = await t.run((ctx) =>
    ctx.db.query("meteredProductOffers").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].providerJson).toBeUndefined();
});
