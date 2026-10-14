// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const client = vi.hoisted(() => ({
  getSubscriptionFromStripe: vi.fn(),
  prepareBalanceFunding: vi.fn(),
  setBalanceFunding: vi.fn(),
}));
vi.mock("./lib/balanceStripe", () => ({ balanceStripe: client }));
const modules = import.meta.glob("./**/*.*s");
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  client.prepareBalanceFunding.mockResolvedValue({
    customerAccount: "acct_store",
    stripeSubscriptionId: "sub_store",
    paymentMethodId: "pm_balance",
    previousPaymentMethodId: "pm_card",
    previousPaymentMethodTypes: ["card"],
  });
  client.setBalanceFunding.mockResolvedValue({ enabled: true });
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
  client.getSubscriptionFromStripe.mockResolvedValue({
    id: "sub_store",
    customer_account: "acct_store",
    status: "active",
    metadata: { sellerId, storeBilling: "plan_v1" },
  });
  return { t, sellerId };
}
it("requires explicit seller consent before provisioning", async () => {
  const { t, sellerId } = await setup();
  await expect(
    t.action(api.storeBalanceActions.setFunding, { sellerId, enabled: true }),
  ).rejects.toThrow(/Authorize/);
  expect(client.prepareBalanceFunding).not.toHaveBeenCalled();
});
it("persists restoration data before enabling and restores it on opt-out", async () => {
  const { t, sellerId } = await setup();
  client.setBalanceFunding.mockImplementation(async () => {
    expect(
      await t.query(internal.storeBalanceFunding.read, { sellerId }),
    ).toMatchObject({
      previousPaymentMethodId: "pm_card",
      previousPaymentMethodTypes: ["card"],
      operationPending: true,
    });
    return { enabled: true };
  });
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: true,
    consent: true,
  });
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: true });
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: false,
  });
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: false });
  const [enable, disable] = client.setBalanceFunding.mock.calls.map(
    (call) => call[1],
  );
  expect(enable.preparation).toMatchObject({
    previousPaymentMethodId: "pm_card",
    paymentMethodId: "pm_balance",
  });
  expect(disable.preparation).toEqual(enable.preparation);
  expect(disable.idempotencyKey).not.toBe(enable.idempotencyKey);
  expect(disable.enabled).toBe(false);
});
it("reuses pending request identity after provider failure and prevents opposite updates racing it", async () => {
  const { t, sellerId } = await setup();
  client.setBalanceFunding.mockRejectedValueOnce(
    new Error("Preview unavailable"),
  );
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
  await expect(
    t.action(api.storeBalanceActions.setFunding, { sellerId, enabled: false }),
  ).rejects.toThrow(/pending/);
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: true,
    consent: true,
  });
  expect(client.prepareBalanceFunding).toHaveBeenCalledTimes(1);
  expect(client.setBalanceFunding.mock.calls[1][1].idempotencyKey).toBe(
    client.setBalanceFunding.mock.calls[0][1].idempotencyKey,
  );
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: true });
});
it("uses a new operation identity when balance payments are re-enabled", async () => {
  const { t, sellerId } = await setup();
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: true,
    consent: true,
  });
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: false,
  });
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: true,
    consent: true,
  });
  const keys = client.setBalanceFunding.mock.calls.map(
    (call) => call[1].idempotencyKey,
  );
  expect(new Set(keys).size).toBe(3);
  expect(client.prepareBalanceFunding).toHaveBeenCalledTimes(1);
});
it("recovers a provider success whose host completion write never happened", async () => {
  const { t, sellerId } = await setup();
  await t.mutation(internal.storeBalanceFunding.save, {
    sellerId,
    subscriptionId: "sub_store",
    enabled: false,
    paymentMethodId: "pm_balance",
    previousPaymentMethodId: "pm_card",
    previousPaymentMethodTypes: ["card"],
    consentAt: Date.now(),
  });
  const pending = await t.mutation(internal.storeBalanceFunding.begin, {
    sellerId,
    enabled: true,
    consent: true,
  });
  // The provider has accepted the change, but the worker dies before finish.
  const providerAppliedKey = pending!.key;
  client.setBalanceFunding.mockImplementation(async (_ctx, args) => {
    expect(args.idempotencyKey).toBe(providerAppliedKey);
    return { enabled: true };
  });
  expect(
    await t.query(api.storeBalanceFunding.state, { sellerId }),
  ).toMatchObject({ enabled: false });
  await t.action(api.storeBalanceActions.setFunding, {
    sellerId,
    enabled: true,
    consent: true,
  });
  expect(client.prepareBalanceFunding).not.toHaveBeenCalled();
  expect(
    await t.query(internal.storeBalanceFunding.read, { sellerId }),
  ).toMatchObject({
    enabled: true,
    operationPending: false,
    previousPaymentMethodId: "pm_card",
  });
  const next = await t.mutation(internal.storeBalanceFunding.begin, {
    sellerId,
    enabled: false,
  });
  await expect(
    t.mutation(internal.storeBalanceFunding.finish, {
      sellerId,
      enabled: true,
      version: pending!.version,
    }),
  ).rejects.toThrow(/changed/);
  expect(next!.version).toBeGreaterThan(pending!.version);
});
