// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const calls = vi.hoisted(() => ({
  payout: vi.fn(async () => ({ id: "po_test", status: "pending" })),
  transfer: vi.fn(async () => ({
    amount: 1001,
    id: "tr_test",
    destination: "acct_affiliate",
    currency: "usd",
    source_transaction: "ch_test",
  })),
  charge: vi.fn(async () => ({
    metadata: { bsRecoveryFixture: "regression" },
  })),
  balance: vi.fn(async () => ({
    available: [{ currency: "usd", amount: 1001 }],
  })),
  create: vi.fn(async (params: Record<string, unknown>) => {
    if (params.allowed_payment_method_types && params.automatic_payment_methods)
      throw new Error("Mutually exclusive Stripe payment parameters");
    return { id: "pi_test" };
  }),
  sale: vi.fn(async () => ({ status: "pending", reason: "awaiting fee" })),
}));
vi.mock("./lib/stripeClient", () => ({
  getStripeClient: () => ({
    paymentIntents: { create: calls.create },
    transfers: { retrieve: calls.transfer },
    charges: { retrieve: calls.charge },
    balance: { retrieve: calls.balance },
    payouts: {
      create: calls.payout,
      list: vi.fn(async () => ({ data: [], has_more: false })),
    },
  }),
}));
vi.mock("./stripe", () => ({ stripe: { getVerifiedSale: calls.sale } }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
it("creates the sandbox payment without conflicting payment method settings", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const result = JSON.parse(
    await t.action(internal.affiliateRecoverySandbox.seed, {
      runKey: "regression",
      storeAccountId: "acct_store",
      affiliateAccountId: "acct_affiliate",
      scenario: "refund_partial",
    }),
  );
  expect(result.paymentIntentId).toBe("pi_test");
  expect(calls.create).toHaveBeenCalledWith(
    expect.objectContaining({
      payment_method: "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    }),
    expect.objectContaining({
      idempotencyKey: "recovery-fixture:regression:payment",
    }),
  );
});

it("pays out only a fixture transfer's verified recipient using actual available funds", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const args = {
    runKey: "regression",
    affiliateAccountId: "acct_affiliate",
    stripeTransferId: "tr_test",
  };
  const result = JSON.parse(
    await t.action(internal.affiliateRecoverySandbox.externalPayout, args),
  );
  expect(result.id).toBe("po_test");
  expect(calls.payout).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 1001, currency: "usd" }),
    expect.objectContaining({
      stripeAccount: "acct_affiliate",
      idempotencyKey: "recovery-fixture:regression:external-payout",
    }),
  );
  await expect(
    t.action(internal.affiliateRecoverySandbox.externalPayout, {
      ...args,
      affiliateAccountId: "acct_other",
    }),
  ).rejects.toThrow("fixture recipient");
});
it("uses immediately available sandbox funds for the external payout scenario", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  await t.action(internal.affiliateRecoverySandbox.seed, {
    runKey: "available",
    storeAccountId: "acct_store",
    affiliateAccountId: "acct_affiliate",
    scenario: "paid_out",
  });
  expect(calls.create).toHaveBeenCalledWith(
    expect.objectContaining({ payment_method: "pm_card_bypassPending" }),
    expect.anything(),
  );
});
it("funds only the test platform with a bounded, idempotent sandbox payment", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  await t.action(internal.affiliateRecoverySandbox.fundPlatform, {
    runKey: "funding",
    amount: 100000,
  });
  expect(calls.create).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: 100000,
      payment_method: "pm_card_bypassPending",
    }),
    expect.objectContaining({
      idempotencyKey: "recovery-fixture:funding:platform-funding",
    }),
  );
  await expect(
    t.action(internal.affiliateRecoverySandbox.fundPlatform, {
      runKey: "funding",
      amount: 100001,
    }),
  ).rejects.toThrow("bounded");
});
