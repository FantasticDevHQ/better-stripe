// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const raw = vi.hoisted(() => ({
  v2: {
    core: {
      accounts: {
        retrieve: vi.fn(async () => ({
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { status: "active" } },
              },
            },
          },
        })),
      },
    },
  },
  paymentIntents: {
    create: vi.fn(async (params: Record<string, unknown>) => ({
      id: `pi_fixture_${String(params.amount)}`,
    })),
  },
  refunds: { create: vi.fn(async () => ({ id: "re_fixture" })) },
}));
const catalog = vi.hoisted(() => ({
  createProduct: vi.fn(async () => ({ stripeProductId: "prod_owned" })),
  createPrice: vi.fn(async () => ({ stripePriceId: "price_owned" })),
}));
vi.mock("./lib/stripeClient", () => ({ getStripeClient: () => raw }));
vi.mock("./stripe", () => ({
  stripe: {
    ...catalog,
    getVerifiedSale: async () => ({ status: "not_payable" }),
  },
}));
const modules = import.meta.glob("./**/*.*s");
afterEach(() => vi.unstubAllEnvs());
it("binds sandbox refund and immediate-dispute purchases to actual seller-owned catalog sources", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture_only");
  const t = convexTest(schema, modules);
  const sellerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "QA seller",
      email: "qa@example.com",
      role: "seller",
      testFixture: true,
      stripeAccountId: "acct_owner",
    }),
  );
  await t.action(internal.sandboxRenewals.seedCases, {
    sellerId,
    funded: false,
  });
  expect(raw.paymentIntents.create).toHaveBeenCalledTimes(2);
  for (const [params] of raw.paymentIntents.create.mock.calls) {
    expect(params).toMatchObject({
      metadata: {
        sellerId,
        stripePriceId: "price_owned",
        stripeProductId: "prod_owned",
        storeBilling: "sale_v1",
      },
    });
  }
  expect(catalog.createProduct).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      accountId: "acct_owner",
      idempotencyKey: expect.any(String),
    }),
  );
  expect(catalog.createPrice).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      stripeProductId: "prod_owned",
      currency: "usd",
      type: "one_time",
      idempotencyKey: expect.any(String),
    }),
  );
});
