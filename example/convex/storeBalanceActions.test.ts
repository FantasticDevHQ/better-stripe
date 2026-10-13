// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  paymentMethods: { attach: vi.fn() },
  rawRequest: vi.fn(),
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
const modules = import.meta.glob("./**/*.*s");
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  raw.rawRequest.mockResolvedValue({
    id: "pm_balance",
    type: "stripe_balance",
  });
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Seller",
      email: "seller@example.com",
      role: "seller",
      stripeAccountId: "acct_store",
      storePlan: {
        planId: "growth",
        stripeSubscriptionId: "sub_store",
        status: "active",
        paidThrough: Date.now() + 86400000,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  raw.subscriptions.retrieve.mockResolvedValue({
    id: "sub_store",
    customer_account: "acct_store",
    status: "active",
    default_payment_method: "pm_card",
    payment_settings: { payment_method_types: ["card"] },
    metadata: { sellerId, storeBilling: "plan_v1" },
  });
  return { t, sellerId };
}
it("requires explicit seller consent before creating a balance payment method", async () => {
  const { t, sellerId } = await setup();
  await expect(
    t.action(api.storeBalanceActions.setFunding, { sellerId, enabled: true }),
  ).rejects.toThrow(/Authorize/);
  expect(raw.rawRequest).not.toHaveBeenCalled();
});
it("attaches balance payment to the seller and restores the previous method on opt-out", async () => {
  const { t, sellerId } = await setup();
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: true,
    consent: true,
  });
  expect(raw.rawRequest).toHaveBeenCalledWith(
    "POST",
    "/v1/payment_methods",
    { type: "stripe_balance" },
    expect.objectContaining({ apiVersion: "2026-09-30.preview" }),
  );
  expect(raw.paymentMethods.attach).toHaveBeenCalledWith(
    "pm_balance",
    { customer_account: "acct_store" },
    expect.anything(),
  );
  expect(raw.rawRequest).toHaveBeenCalledWith(
    "POST",
    "/v1/subscriptions/sub_store",
    {
      default_payment_method: "pm_balance",
      payment_settings: { payment_method_types: ["stripe_balance"] },
    },
    expect.anything(),
  );
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: true });
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: false,
  });
  expect(raw.rawRequest).toHaveBeenCalledWith(
    "POST",
    "/v1/subscriptions/sub_store",
    {
      default_payment_method: "pm_card",
      payment_settings: { payment_method_types: ["card"] },
    },
    expect.anything(),
  );
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: false });
});
it("keeps balance funding disabled if Stripe rejects the subscription update", async () => {
  const { t, sellerId } = await setup();
  raw.rawRequest.mockImplementation(async (_method, path) => {
    if (path.includes("subscriptions")) throw new Error("Preview unavailable");
    return { id: "pm_balance", type: "stripe_balance" };
  });
  await expect(
    t.action(api.storeBalanceActions.setFunding, {
      sellerId,
      enabled: true,
      consent: true,
    }),
  ).rejects.toThrow(/Preview/);
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: false });
  expect(
    await t.query(internal.storeBalanceFunding.read, { sellerId }),
  ).toMatchObject({ previousPaymentMethodId: "pm_card" });
});
