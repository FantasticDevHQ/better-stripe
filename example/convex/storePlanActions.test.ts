// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), list: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
  testHelpers: { testClocks: { retrieve: vi.fn() } },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
vi.mock("./stripe", () => ({
  stripe: { addCustomerConfiguration: vi.fn(), createCheckoutSession: vi.fn() },
}));
import { stripe } from "./stripe";
const modules = import.meta.glob("./**/*.*s");
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
  await t.mutation(internal.storePlanBilling.saveCatalogPrice, {
    planId: "growth",
    stripeProductId: "prod_plans",
    stripePriceId: "price_growth",
  });
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
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    await t.query(api.storePlanBilling.getState, { sellerId }),
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
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    await t.query(api.storePlanBilling.getState, { sellerId }),
  ).toMatchObject({ hasAccess: false, storePlan: { status: "unpaid" } });
});
it("keeps a paid cancel-at-period-end store open, then closes it after Stripe cancels", async () => {
  const { t, sellerId, sub } = await setup();
  raw.subscriptions.retrieve.mockResolvedValue({
    ...sub,
    cancel_at_period_end: true,
  });
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    await t.query(api.storePlanBilling.getState, { sellerId }),
  ).toMatchObject({ hasAccess: true, storePlan: { cancelAtPeriodEnd: true } });
  raw.subscriptions.retrieve.mockResolvedValue({ ...sub, status: "canceled" });
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: "sub_store",
  });
  expect(
    (await t.query(api.storePlanBilling.getState, { sellerId })).hasAccess,
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
    t.action(api.storePlanActions.confirmCheckout, {
      sellerId,
      sessionId: "cs_forged",
    }),
  ).rejects.toThrow(/not completed/);
  expect(raw.subscriptions.retrieve).not.toHaveBeenCalled();
  expect(
    (await t.query(api.storePlanBilling.getState, { sellerId })).hasAccess,
  ).toBe(false);
});

it("creates checkout with dynamic payment methods and configures the seller as a billable customer first", async () => {
  const { t, sellerId } = await setup();
  for (const planId of ["starter", "growth", "pro"] as const)
    await t.mutation(internal.storePlanBilling.saveCatalogPrice, {
      planId,
      stripeProductId: `prod_${planId}`,
      stripePriceId: `price_${planId}`,
    });
  raw.subscriptions.list.mockResolvedValue({ data: [] });
  vi.mocked(stripe.addCustomerConfiguration).mockResolvedValue({} as never);
  vi.mocked(stripe.createCheckoutSession).mockResolvedValue({
    stripeSessionId: "cs_plan",
    clientSecret: "sandbox_secret",
    url: undefined,
  });
  await t.action(api.storePlanActions.createCheckout, {
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
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  await t.mutation(internal.storePlanBilling.saveCatalogPrice, {
    planId: "pro",
    stripePriceId: "price_pro",
    stripeProductId: "prod_pro",
  });
  raw.subscriptions.retrieve.mockResolvedValue({
    ...sub,
    latest_invoice: { id: "in_upgrade", status: "open" },
    items: { data: [{ ...sub.items.data[0], price: { id: "price_pro" } }] },
  });
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  expect(
    await t.query(api.storePlanBilling.getState, { sellerId }),
  ).toMatchObject({
    hasAccess: true,
    storePlan: { planId: "growth", status: "active" },
  });
});

it("expires the paid period at the Stripe test clock when a renewal is unpaid", async () => {
  const { t, sellerId, sub } = await setup();
  await t.action(internal.storePlanActions.refreshSubscription, {
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
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  expect(
    await t.query(api.storePlanBilling.getState, { sellerId }),
  ).toMatchObject({ hasAccess: false, storePlan: { status: "past_due" } });
});
it("recognizes an existing subscription price after the admin publishes a newer catalog price", async () => {
  const { t, sellerId, sub } = await setup();
  Object.assign(sub.items.data[0].price, {
    metadata: { storePlanId: "growth" },
  });
  await t.mutation(internal.storePlanBilling.saveCatalogPrice, {
    planId: "growth",
    stripeProductId: "prod_plans",
    stripePriceId: "price_new",
  });
  await t.action(internal.storePlanActions.refreshSubscription, {
    subscriptionId: sub.id,
  });
  expect(
    await t.query(api.storePlanBilling.getState, { sellerId }),
  ).toMatchObject({
    hasAccess: true,
    storePlan: { planId: "growth", stripeSubscriptionId: sub.id },
  });
});
