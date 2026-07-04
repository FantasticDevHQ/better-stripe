// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Mocked unit coverage for the admin Testing page's actions (BTS-77).
 *
 * `adminTesting.ts`'s `fire*` actions make REAL Stripe test-mode API calls —
 * that's the whole point of the page (BTS-45) — so `describeLedgerSync` was
 * the only piece with unit coverage before this file (see
 * `adminTesting.test.ts`). Here we mock the two Stripe-calling seams —
 * `./stripe` (the app's `BetterStripe` singleton) and the `stripe` npm
 * package (used directly by `rawStripe()`) — so the actions' own logic
 * (demo-account resolution, the poll-until-synced loop, and each action's
 * happy path) gets real, fast, deterministic unit coverage without a live
 * key or network call. `convex-test` still runs `requireDemoAccounts`'s
 * `getDemoAccounts` query and (for `fireCheckoutCompleted`) the component's
 * real `payments` ledger for real — only the Stripe-API edge is mocked.
 */
import { convexTest } from "convex-test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

// The mocked `BetterStripe` singleton — every method the actions under test
// call is a bare `vi.fn()`; each test configures the return values it needs.
vi.mock("./stripe", () => ({
  stripe: {
    updateV2Account: vi.fn(),
    getAccountByStripeId: vi.fn(),
    getActiveSubscription: vi.fn(),
    updateSubscriptionMetadata: vi.fn(),
    getSubscriptionByStripeId: vi.fn(),
    createSubscription: vi.fn(),
    listInvoices: vi.fn(),
    listProducts: vi.fn(),
    listPricesByProduct: vi.fn(),
  },
}));

// `rawStripe()` constructs `new Stripe(key, ...)` directly (bypassing the
// BetterStripe singleton) for the one-time PaymentIntent in
// `fireCheckoutCompleted`. Mock the SDK's default export so that construction
// never hits the network.
const paymentIntentsCreate = vi.fn();
vi.mock("stripe", () => ({
  default: class FakeStripe {
    paymentIntents = { create: paymentIntentsCreate };
  },
}));

import { api, components } from "./_generated/api";
import schema from "./schema";
import { stripe as mockedStripeUntyped } from "./stripe";
// The installed component, loaded from the built output the example resolves
// (same pattern as seed.test.ts/queries.test.ts).
import componentSchema from "../../dist/component/schema.js";

const modules = import.meta.glob("./**/*.*s");
const componentModules = import.meta.glob("../../dist/component/**/*.js");

type MockedStripe = {
  updateV2Account: Mock;
  getAccountByStripeId: Mock;
  getActiveSubscription: Mock;
  updateSubscriptionMetadata: Mock;
  getSubscriptionByStripeId: Mock;
  createSubscription: Mock;
  listInvoices: Mock;
  listProducts: Mock;
  listPricesByProduct: Mock;
};
const mockedStripe = mockedStripeUntyped as unknown as MockedStripe;

function withComponent() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterStripe", componentSchema, componentModules);
  return t;
}

/** Seeds exactly the two personas `getDemoAccounts` (adminTesting.ts) looks up. */
async function seedDemoAccounts(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      name: "Maya Merchant",
      email: "maya@example.com",
      role: "seller",
      stripeAccountId: "acct_store_mock",
    });
    await ctx.db.insert("users", {
      name: "Billie Buyer",
      email: "billie@example.com",
      role: "buyer",
      stripeAccountId: "acct_buyer_mock",
    });
  });
}

const TEST_KEY = "sk_test_mock_admin_testing";

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = TEST_KEY;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

// =============================================================================
// requireDemoAccounts — null/throw path (~adminTesting.ts:96-99)
// =============================================================================

describe("adminTesting actions — requireDemoAccounts guard", () => {
  it("throws an actionable error when the marketplace demo isn't seeded", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.adminTesting.fireAccountUpdated, {}),
    ).rejects.toThrowError(/not seeded.*npm run setup/is);
  });

  it("throws the same guard when only one persona is linked", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Maya Merchant",
        email: "maya@example.com",
        role: "seller",
        stripeAccountId: "acct_store_mock",
      });
      // Billie is missing a stripeAccountId — getDemoAccounts requires both.
      await ctx.db.insert("users", {
        name: "Billie Buyer",
        email: "billie@example.com",
        role: "buyer",
      });
    });

    await expect(
      t.action(api.adminTesting.fireAccountUpdated, {}),
    ).rejects.toThrowError(/not seeded/i);
  });
});

// =============================================================================
// pollForLedgerRow — retry/timeout loop, driven through fireAccountUpdated
// =============================================================================

describe("adminTesting actions — pollForLedgerRow retry/timeout loop", () => {
  it("retries until the row appears and reports the attempt it took", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      await seedDemoAccounts(t);
      mockedStripe.updateV2Account.mockResolvedValue(undefined);

      let calls = 0;
      mockedStripe.getAccountByStripeId.mockImplementation(async () => {
        calls += 1;
        return calls < 3 ? null : { stripeAccountId: "acct_store_mock" };
      });

      const resultPromise = t.action(api.adminTesting.fireAccountUpdated, {});
      // The row appears on the 3rd check; two 2s sleeps happen in between.
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(calls).toBe(3);
      expect(result.ledgerSync).toBe(
        "Synced to the component ledger after 3/5 polls.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after POLL_ATTEMPTS and reports the not-yet-synced message", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      await seedDemoAccounts(t);
      mockedStripe.updateV2Account.mockResolvedValue(undefined);
      mockedStripe.getAccountByStripeId.mockResolvedValue(null);

      const resultPromise = t.action(api.adminTesting.fireAccountUpdated, {});
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(2_000);
      }
      const result = await resultPromise;

      expect(mockedStripe.getAccountByStripeId).toHaveBeenCalledTimes(5);
      expect(result.ledgerSync).toContain("Not yet synced after 5 polls");
      expect(result.ledgerSync).toContain("stripe listen");
    } finally {
      vi.useRealTimers();
    }
  });
});

// =============================================================================
// fire* happy paths
// =============================================================================

describe("adminTesting actions — fire* happy paths", () => {
  it("fireAccountUpdated pings the account and reports an immediate sync", async () => {
    const t = convexTest(schema, modules);
    await seedDemoAccounts(t);
    mockedStripe.updateV2Account.mockResolvedValue(undefined);
    mockedStripe.getAccountByStripeId.mockResolvedValue({
      stripeAccountId: "acct_store_mock",
    });

    const result = await t.action(api.adminTesting.fireAccountUpdated, {});

    expect(mockedStripe.updateV2Account).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stripeAccountId: "acct_store_mock",
        updateParams: {
          metadata: { bsAdminTestPing: expect.any(String) },
        },
      }),
    );
    expect(result.stripeAccountId).toBe("acct_store_mock");
    expect(result.ledgerSync).toBe(
      "Synced to the component ledger after 1/5 poll.",
    );
    expect(result.componentRow).toEqual({ stripeAccountId: "acct_store_mock" });
  });

  it("fireSubscriptionUpdated requires an active subscription first", async () => {
    const t = convexTest(schema, modules);
    await seedDemoAccounts(t);
    mockedStripe.getActiveSubscription.mockResolvedValue(null);

    await expect(
      t.action(api.adminTesting.fireSubscriptionUpdated, {}),
    ).rejects.toThrowError(/No active subscription/);
  });

  it("fireSubscriptionUpdated pings the active subscription and reports an immediate sync", async () => {
    const t = convexTest(schema, modules);
    await seedDemoAccounts(t);
    mockedStripe.getActiveSubscription.mockResolvedValue({
      stripeSubscriptionId: "sub_mock_1",
      status: "active",
    });
    mockedStripe.updateSubscriptionMetadata.mockResolvedValue({
      success: true,
    });
    mockedStripe.getSubscriptionByStripeId.mockResolvedValue({
      stripeSubscriptionId: "sub_mock_1",
      status: "active",
    });

    const result = await t.action(
      api.adminTesting.fireSubscriptionUpdated,
      {},
    );

    expect(mockedStripe.updateSubscriptionMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripeSubscriptionId: "sub_mock_1" }),
    );
    expect(result.stripeSubscriptionId).toBe("sub_mock_1");
    expect(result.ledgerSync).toBe(
      "Synced to the component ledger after 1/5 poll.",
    );
  });

  it("fireCheckoutCompleted creates a real-shaped PaymentIntent and finds the persisted payment row", async () => {
    const t = withComponent();
    await seedDemoAccounts(t);
    paymentIntentsCreate.mockResolvedValue({
      id: "pi_mock_1",
      status: "succeeded",
    });
    // The row `getPaymentRow` (e2eMoney.ts) polls for — pre-inserted since the
    // mocked PaymentIntent never actually round-trips through a webhook.
    await t.mutation(components.betterStripe.connect.mutations.upsertPayment, {
      stripePaymentIntentId: "pi_mock_1",
      userId: "",
      accountId: "acct_store_mock",
      amount: 500,
      currency: "usd",
      status: "succeeded",
    });

    const result = await t.action(api.adminTesting.fireCheckoutCompleted, {});

    expect(paymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        currency: "usd",
        transfer_data: { destination: "acct_store_mock" },
      }),
    );
    expect(result.stripePaymentIntentId).toBe("pi_mock_1");
    expect(result.ledgerSync).toBe(
      "Synced to the component ledger after 1/5 poll.",
    );
    expect(result.componentRow).toMatchObject({
      stripePaymentIntentId: "pi_mock_1",
      status: "succeeded",
    });
  });

  it("fireInvoicePaid creates a subscription and finds the paid invoice", async () => {
    const t = convexTest(schema, modules);
    await seedDemoAccounts(t);
    // getMarketplaceDemoContext (marketplace.ts) reads through the same
    // mocked `stripe` singleton to resolve Maya's monthly price.
    mockedStripe.listProducts.mockResolvedValue([
      { stripeProductId: "prod_mock_1" },
    ]);
    mockedStripe.listPricesByProduct.mockResolvedValue([
      {
        stripePriceId: "price_mock_1",
        type: "recurring",
        interval: "month",
        unitAmount: 2900,
        currency: "usd",
      },
    ]);
    mockedStripe.createSubscription.mockResolvedValue({
      stripeSubscriptionId: "sub_invoice_mock_1",
      status: "active",
    });
    mockedStripe.listInvoices.mockResolvedValue([
      { stripeInvoiceId: "in_mock_1", status: "paid" },
    ]);

    const result = await t.action(api.adminTesting.fireInvoicePaid, {});

    expect(mockedStripe.createSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerAccount: "acct_buyer_mock",
        destinationAccountId: "acct_store_mock",
        stripePriceId: "price_mock_1",
      }),
    );
    expect(result.stripeSubscriptionId).toBe("sub_invoice_mock_1");
    expect(result.ledgerSync).toBe(
      "Synced to the component ledger after 1/5 poll.",
    );
    expect(result.componentRow).toEqual({
      stripeInvoiceId: "in_mock_1",
      status: "paid",
    });
  });

  it("fireInvoicePaid throws when the marketplace demo context isn't seeded", async () => {
    const t = convexTest(schema, modules);
    await seedDemoAccounts(t);
    // No products/prices seeded → getMarketplaceDemoContext resolves null.
    mockedStripe.listProducts.mockResolvedValue([]);

    await expect(
      t.action(api.adminTesting.fireInvoicePaid, {}),
    ).rejects.toThrowError(/Marketplace demo context not seeded/);
  });
});

// =============================================================================
// Fail-closed guard — the fire* actions refuse to run against a live key
// (unit coverage for `assertTestModeStripeKey` itself lives in
// adminTesting.test.ts; this proves it's actually wired into the actions).
// =============================================================================

describe("adminTesting actions — refuse a live/misconfigured key (BTS-77)", () => {
  it("fireAccountUpdated throws before touching Stripe when the key is live", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = convexTest(schema, modules);
    await seedDemoAccounts(t);

    await expect(
      t.action(api.adminTesting.fireAccountUpdated, {}),
    ).rejects.toThrowError(/test-mode key/);
    expect(mockedStripe.updateV2Account).not.toHaveBeenCalled();
  });

  it("fireCheckoutCompleted throws before constructing a raw Stripe client when the key is live", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_run";
    const t = withComponent();
    await seedDemoAccounts(t);

    await expect(
      t.action(api.adminTesting.fireCheckoutCompleted, {}),
    ).rejects.toThrowError(/test-mode key/);
    expect(paymentIntentsCreate).not.toHaveBeenCalled();
  });
});
