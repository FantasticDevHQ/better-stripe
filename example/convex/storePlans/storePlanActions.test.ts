import { modules } from "../../test";
// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { stripe } from "../stripe/helpers";
const raw = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), list: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
  testHelpers: { testClocks: { retrieve: vi.fn() } },
  billingPortal: {
    configurations: { create: vi.fn() },
    sessions: { create: vi.fn() },
  },
}));
vi.mock("../stripe/client", () => ({ getStripeClient: () => raw }));
vi.mock("../stripe/helpers", () => ({
  stripe: {
    addCustomerConfiguration: vi.fn(),
    createCheckoutSession: vi.fn(),
    createBillingPortalConfiguration: vi.fn(),
    createBillingPortalSession: vi.fn(),
  },
}));
beforeEach(() => vi.resetAllMocks());
async function setup() {
  const t = convexTest(schema, modules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
    }),
  );
  await t.mutation(
    internal.storePlans.billing.internal.mutations.saveCatalogPrice,
    {
      planId: "growth",
      stripeProductId: "prod_plans",
      stripePriceId: "price_growth",
    },
  );
  const sub = {
    id: "sub_store",
    status: "active",
    metadata: { storeBilling: "plan_v1", sellerId },
    latest_invoice: { id: "in_store", status: "paid" },
    items: {
      data: [
        {
          price: { id: "price_growth" },
          quantity: 1,
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
        },
      ],
    },
    cancel_at_period_end: false,
  };
  raw.subscriptions.retrieve.mockResolvedValue(sub);
  return { t, sellerId, sub };
}
it("activates a seller only from a paid Stripe subscription with a recognized monthly price", async () => {
  const { t, sellerId } = await setup();
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    await t.query(api.storePlans.billing.public.queries.getState, { sellerId }),
  ).toMatchObject({
    hasAccess: true,
    storePlan: { planId: "growth", status: "active" },
  });
});
it("does not grant access when the subscription exists but its invoice remains unpaid", async () => {
  const { t, sellerId, sub } = await setup();
  raw.subscriptions.retrieve.mockResolvedValue({
    ...sub,
    latest_invoice: { id: "in_store", status: "open" },
  });
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    await t.query(api.storePlans.billing.public.queries.getState, { sellerId }),
  ).toMatchObject({ hasAccess: false, storePlan: { status: "unpaid" } });
});
it("keeps a paid cancel-at-period-end store open, then closes it after Stripe cancels", async () => {
  const { t, sellerId, sub } = await setup();
  raw.subscriptions.retrieve.mockResolvedValue({
    ...sub,
    cancel_at_period_end: true,
  });
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    await t.query(api.storePlans.billing.public.queries.getState, { sellerId }),
  ).toMatchObject({ hasAccess: true, storePlan: { cancelAtPeriodEnd: true } });
  raw.subscriptions.retrieve.mockResolvedValue({ ...sub, status: "canceled" });
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    (
      await t.query(api.storePlans.billing.public.queries.getState, {
        sellerId,
      })
    ).hasAccess,
  ).toBe(false);
});
it("rejects a forged or unpaid checkout return without granting plan access", async () => {
  const { t, sellerId } = await setup();
  raw.checkout.sessions.retrieve.mockResolvedValue({
    metadata: { storeBilling: "plan_v1", sellerId },
    payment_status: "unpaid",
    subscription: "sub_store",
  });
  await expect(
    t.action(api.storePlans.public.actions.confirmCheckout, {
      sellerId,
      sessionId: "cs_forged",
    }),
  ).rejects.toThrow(/not completed/);
  expect(raw.subscriptions.retrieve).not.toHaveBeenCalled();
  expect(
    (
      await t.query(api.storePlans.billing.public.queries.getState, {
        sellerId,
      })
    ).hasAccess,
  ).toBe(false);
});

it("creates checkout with dynamic payment methods and configures the seller as a billable customer first", async () => {
  const { t, sellerId } = await setup();
  for (const planId of ["starter", "growth", "pro"] as const)
    await t.mutation(
      internal.storePlans.billing.internal.mutations.saveCatalogPrice,
      {
        planId,
        stripeProductId: `prod_${planId}`,
        stripePriceId: `price_${planId}`,
      },
    );
  raw.subscriptions.list.mockResolvedValue({ data: [] });
  vi.mocked(stripe.addCustomerConfiguration).mockResolvedValue({} as never);
  vi.mocked(stripe.createCheckoutSession).mockResolvedValue({
    stripeSessionId: "cs_plan",
    clientSecret: "sandbox_secret",
    url: undefined,
  });
  await t.action(api.storePlans.public.actions.createCheckout, {
    sellerId,
    planId: "growth",
    returnUrl:
      "http://localhost:5173/seller/plan?session_id={CHECKOUT_SESSION_ID}",
  });
  expect(stripe.addCustomerConfiguration).toHaveBeenCalledWith(
    expect.anything(),
    { stripeAccountId: "acct_store" },
  );
  expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      accountId: "acct_store",
      stripePriceId: "price_growth",
      mode: "subscription",
      sessionOverrides: { adaptive_pricing: { enabled: false } },
    }),
  );
  const options = vi.mocked(stripe.createCheckoutSession).mock.calls[0][1];
  expect(options.sessionOverrides).not.toHaveProperty("payment_method_types");
});
it("keeps the already-paid tier while an upgrade invoice is still open", async () => {
  const { t, sellerId, sub } = await setup();
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  await t.mutation(
    internal.storePlans.billing.internal.mutations.saveCatalogPrice,
    {
      planId: "pro",
      stripePriceId: "price_pro",
      stripeProductId: "prod_pro",
    },
  );
  raw.subscriptions.retrieve.mockResolvedValue({
    ...sub,
    latest_invoice: { id: "in_upgrade", status: "open" },
    items: { data: [{ ...sub.items.data[0], price: { id: "price_pro" } }] },
  });
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  expect(
    await t.query(api.storePlans.billing.public.queries.getState, { sellerId }),
  ).toMatchObject({
    hasAccess: true,
    storePlan: { planId: "growth", status: "active" },
  });
});

it("expires the paid period at the Stripe test clock when a renewal is unpaid", async () => {
  const { t, sellerId, sub } = await setup();
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  raw.subscriptions.retrieve.mockResolvedValue({
    ...sub,
    status: "past_due",
    test_clock: "clock_store",
    latest_invoice: { id: "in_renewal", status: "open" },
  });
  raw.testHelpers.testClocks.retrieve.mockResolvedValue({
    frozen_time: sub.items.data[0].current_period_end + 1,
  });
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  expect(
    await t.query(api.storePlans.billing.public.queries.getState, { sellerId }),
  ).toMatchObject({ hasAccess: false, storePlan: { status: "past_due" } });
});
it("recognizes an existing subscription price after the admin publishes a newer catalog price", async () => {
  const { t, sellerId, sub } = await setup();
  Object.assign(sub.items.data[0].price, {
    metadata: { storePlanId: "growth" },
  });
  await t.mutation(
    internal.storePlans.billing.internal.mutations.saveCatalogPrice,
    {
      planId: "growth",
      stripeProductId: "prod_plans",
      stripePriceId: "price_new",
    },
  );
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  expect(
    await t.query(api.storePlans.billing.public.queries.getState, { sellerId }),
  ).toMatchObject({
    hasAccess: true,
    storePlan: { planId: "growth", stripeSubscriptionId: sub.id },
  });
});

it("keeps the app price allowlist and legacy current price in a configured component portal", async () => {
  const { t, sellerId, sub } = await setup();
  await t.action(internal.storePlans.internal.actions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  for (const planId of ["starter", "growth", "pro"] as const)
    await t.mutation(
      internal.storePlans.billing.internal.mutations.saveCatalogPrice,
      {
        planId,
        stripeProductId: `prod_${planId}`,
        stripePriceId: `price_${planId}`,
      },
    );
  Object.assign(sub.items.data[0].price, {
    id: "price_legacy",
    product: "prod_legacy",
  });
  raw.billingPortal.configurations.create.mockResolvedValue({
    id: "bpc_store",
  });
  raw.billingPortal.sessions.create.mockResolvedValue({
    url: "https://billing.stripe.test/store",
  });
  vi.mocked(stripe.createBillingPortalConfiguration).mockResolvedValue({
    id: "bpc_store",
  } as never);
  vi.mocked(stripe.createBillingPortalSession).mockResolvedValue({
    url: "https://billing.stripe.test/store",
  });
  expect(
    await t.action(api.storePlans.public.actions.manage, {
      sellerId,
      returnUrl: "https://example.test/plan",
    }),
  ).toBe("https://billing.stripe.test/store");
  expect(stripe.createBillingPortalConfiguration).toHaveBeenCalledWith(
    expect.anything(),
    {
      params: {
        business_profile: { headline: "Manage your BetterStripe store plan" },
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
          subscription_update: {
            enabled: true,
            default_allowed_updates: ["price"],
            products: expect.arrayContaining([
              { product: "prod_starter", prices: ["price_starter"] },
              { product: "prod_growth", prices: ["price_growth"] },
              { product: "prod_pro", prices: ["price_pro"] },
              { product: "prod_legacy", prices: ["price_legacy"] },
            ]),
            proration_behavior: "always_invoice",
            schedule_at_period_end: { conditions: [] },
          },
        },
      },
    },
  );
  expect(
    vi.mocked(stripe.createBillingPortalConfiguration).mock.calls[0][1].params
      .features?.subscription_update?.products,
  ).toHaveLength(4);
  expect(stripe.createBillingPortalSession).toHaveBeenCalledWith(
    expect.anything(),
    {
      stripeAccountId: "acct_store",
      returnUrl: "https://example.test/plan",
      configurationId: "bpc_store",
    },
  );
  expect(raw.billingPortal.configurations.create).not.toHaveBeenCalled();
  expect(raw.billingPortal.sessions.create).not.toHaveBeenCalled();
});

it("rejects a non-seller before opening a portal", async () => {
  const { t } = await setup();
  const buyerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Buyer",
      email: "buyer@example.test",
      role: "customer",
    }),
  );
  await expect(
    t.action(api.storePlans.public.actions.manage, {
      sellerId: buyerId,
      returnUrl: "https://example.test/plan",
    }),
  ).rejects.toThrow(/seller/);
  expect(stripe.createBillingPortalConfiguration).not.toHaveBeenCalled();
  expect(stripe.createBillingPortalSession).not.toHaveBeenCalled();
  expect(raw.subscriptions.retrieve).not.toHaveBeenCalled();
});
