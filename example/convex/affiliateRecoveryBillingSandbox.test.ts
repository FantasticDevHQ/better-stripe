// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  testHelpers: {
    testClocks: {
      create: vi.fn(async () => ({ id: "clock_test" })),
      retrieve: vi.fn(async () => ({ name: "other" })),
    },
  },
  customers: { create: vi.fn(async () => ({ id: "cus_test" })) },
  paymentMethods: { attach: vi.fn(async () => ({ id: "pm_test" })) },
  products: { create: vi.fn(async () => ({ id: "prod_test" })) },
  prices: { create: vi.fn(async () => ({ id: "price_test" })) },
  subscriptions: {
    create: vi.fn(async () => ({ id: "sub_test" })),
    retrieve: vi.fn(async () => ({
      id: "sub_test",
      latest_invoice: "in_test",
      items: { data: [{ current_period_end: 1794580000 }] },
    })),
  },
  invoicePayments: {
    list: vi.fn(async () => ({
      data: [{ status: "paid", payment: { payment_intent: "pi_test" } }],
    })),
  },
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
afterEach(() => vi.unstubAllEnvs());
it("returns the actual paid recurring invoice payment for the recovery driver", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  const result = JSON.parse(
    await t.action(internal.affiliateRecoveryBillingSandbox.prepare, {
      runKey: "recurring",
      frozenTime: 1792060000,
    }),
  );
  expect(result).toMatchObject({
    subscriptionId: "sub_test",
    invoiceId: "in_test",
    paymentIntentId: "pi_test",
    clockId: "clock_test",
  });
  expect(raw.subscriptions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: "cus_test",
      default_payment_method: "pm_test",
      items: [{ price: "price_test" }],
    }),
    expect.objectContaining({
      idempotencyKey: "recovery-billing:recurring:subscription",
    }),
  );
});
it("refuses to advance a clock belonging to another fixture", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  await expect(
    t.action(internal.affiliateRecoveryBillingSandbox.advance, {
      runKey: "recurring",
      clockId: "clock_other",
      frozenTime: 1794580000,
    }),
  ).rejects.toThrow("fixture clock");
});
