import { beforeEach, describe, expect, it, vi } from "vitest";

import { components as _components } from "./setup.test.js";

const components = _components;

// ---------------------------------------------------------------------------
// Mock Stripe SDK
// ---------------------------------------------------------------------------

const mockStripeInstance = {
  v2: {
    core: {
      accounts: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
      },
    },
  },
  products: {
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },
  prices: {
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  subscriptions: {
    update: vi.fn(),
    cancel: vi.fn(),
    retrieve: vi.fn(),
    list: vi.fn(),
  },
  subscriptionItems: {
    update: vi.fn(),
  },
  paymentMethods: {
    list: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
  },
  invoices: {
    retrieve: vi.fn(),
  },
  accountLinks: {
    create: vi.fn(),
  },
  accounts: {
    createLoginLink: vi.fn(),
  },
  payouts: {
    create: vi.fn(),
  },
};

vi.mock("stripe", () => ({
  default: class StripeMock {
    constructor() {
      return mockStripeInstance;
    }
  },
}));

// ---------------------------------------------------------------------------
// Import BetterStripe after the mock is set up
// ---------------------------------------------------------------------------

const { BetterStripe } = await import("./index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BetterStripe", () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  // =========================================================================
  // Constructor & apiKey
  // =========================================================================

  describe("constructor & apiKey", () => {
    it("accepts STRIPE_SECRET_KEY", () => {
      expect(
        () =>
          new BetterStripe(components.betterStripe, {
            STRIPE_SECRET_KEY: "sk_test_xxx",
          }),
      ).not.toThrow();
    });

    it("apiKey throws when not set", () => {
      const bs = new BetterStripe(components.betterStripe);
      expect(() => bs.apiKey).toThrow("STRIPE_SECRET_KEY is not set");
    });
  });

  // =========================================================================
  // Account methods
  // =========================================================================

  describe("createAccount", () => {
    it("calls Stripe V2 API + upsertAccount mutation", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const fakeAccount = { id: "acct_123" };
      mockStripeInstance.v2.core.accounts.create.mockResolvedValue(fakeAccount);
      mockCtx.runQuery.mockResolvedValue({ _id: "internal_id_1" });

      const result = await bs.createAccount(mockCtx, {
        userId: "user_1",
        email: "test@example.com",
        name: "Test User",
      });

      expect(mockStripeInstance.v2.core.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_email: "test@example.com",
          metadata: expect.objectContaining({ userId: "user_1" }),
        }),
      );
      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        components.betterStripe.core.mutations.upsertAccount,
        expect.objectContaining({
          stripeAccountId: "acct_123",
          userId: "user_1",
          email: "test@example.com",
          name: "Test User",
          onboardingStatus: "pending",
        }),
      );
      expect(result).toEqual({
        accountId: "internal_id_1",
        stripeAccountId: "acct_123",
      });
    });
  });

  // =========================================================================
  // Product methods
  // =========================================================================

  describe("createProduct", () => {
    it("calls Stripe API + upsertProduct mutation", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const fakeProduct = {
        id: "prod_123",
        name: "My Product",
        description: "A product",
        active: true,
        metadata: {},
      };
      mockStripeInstance.products.create.mockResolvedValue(fakeProduct);
      mockCtx.runQuery.mockResolvedValue({ _id: "internal_prod_1" });

      const result = await bs.createProduct(mockCtx, {
        name: "My Product",
        description: "A product",
      });

      expect(mockStripeInstance.products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Product",
          description: "A product",
          active: true,
        }),
      );
      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        components.betterStripe.products.mutations.upsertProduct,
        expect.objectContaining({
          stripeProductId: "prod_123",
          name: "My Product",
          active: true,
        }),
      );
      expect(result).toEqual({
        productId: "internal_prod_1",
        stripeProductId: "prod_123",
      });
    });
  });

  // =========================================================================
  // Price methods
  // =========================================================================

  describe("createPrice", () => {
    it("calls Stripe API + upsertPrice mutation", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const fakePrice = {
        id: "price_123",
        nickname: "Monthly",
        unit_amount: 1999,
        currency: "usd",
        active: true,
        metadata: {},
      };
      mockStripeInstance.prices.create.mockResolvedValue(fakePrice);
      mockCtx.runQuery.mockResolvedValue({ _id: "internal_prod_1" });

      const result = await bs.createPrice(mockCtx, {
        stripeProductId: "prod_123",
        unitAmount: 1999,
        currency: "usd",
        type: "recurring",
        interval: "month",
      });

      expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          product: "prod_123",
          unit_amount: 1999,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1 },
        }),
      );
      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        components.betterStripe.products.mutations.upsertPrice,
        expect.objectContaining({
          stripePriceId: "price_123",
          productId: "internal_prod_1",
          stripeProductId: "prod_123",
          unitAmount: 1999,
          type: "recurring",
          interval: "month",
        }),
      );
      expect(result).toEqual({ stripePriceId: "price_123" });
    });
  });

  // =========================================================================
  // Checkout methods
  // =========================================================================

  describe("createCheckoutSession", () => {
    it("returns clientSecret for embedded ui_mode", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: "cs_123",
        client_secret: "cs_secret_xxx",
        status: "open",
        url: null,
      });

      const result = await bs.createCheckoutSession(mockCtx, {
        userId: "user_1",
        stripePriceId: "price_123",
        mode: "subscription",
        uiMode: "embedded",
        returnUrl: "https://example.com/return",
      });

      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ui_mode: "embedded_page",
          return_url: "https://example.com/return",
        }),
      );
      expect(result.clientSecret).toBe("cs_secret_xxx");
      expect(result.stripeSessionId).toBe("cs_123");
    });

    it("returns url for redirect ui_mode", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.checkout.sessions.create.mockResolvedValue({
        id: "cs_456",
        client_secret: null,
        status: "open",
        url: "https://checkout.stripe.com/pay/cs_456",
      });

      const result = await bs.createCheckoutSession(mockCtx, {
        userId: "user_1",
        stripePriceId: "price_123",
        mode: "subscription",
        uiMode: "redirect",
        returnUrl: "https://example.com/return",
      });

      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          success_url:
            "https://example.com/return?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://example.com/return",
        }),
      );
      expect(result.url).toBe("https://checkout.stripe.com/pay/cs_456");
      expect(result.stripeSessionId).toBe("cs_456");
    });
  });

  // =========================================================================
  // Subscription methods
  // =========================================================================

  describe("cancelSubscription", () => {
    it("uses update with cancel_at_period_end when atPeriodEnd", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      await bs.cancelSubscription(mockCtx, {
        stripeSubscriptionId: "sub_123",
        cancelAtPeriodEnd: true,
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { cancel_at_period_end: true },
      );
      expect(mockStripeInstance.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it("uses cancel for immediate cancellation", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.cancel.mockResolvedValue({});

      await bs.cancelSubscription(mockCtx, {
        stripeSubscriptionId: "sub_123",
        cancelAtPeriodEnd: false,
      });

      expect(mockStripeInstance.subscriptions.cancel).toHaveBeenCalledWith(
        "sub_123",
      );
      expect(mockStripeInstance.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("reactivateSubscription", () => {
    it("sets cancel_at_period_end to false", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      await bs.reactivateSubscription(mockCtx, {
        stripeSubscriptionId: "sub_123",
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { cancel_at_period_end: false },
      );
    });
  });

  // =========================================================================
  // Payment method: setDefaultPaymentMethod
  // =========================================================================

  describe("setDefaultPaymentMethod", () => {
    it("throws not-yet-implemented error", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      await expect(
        bs.setDefaultPaymentMethod(mockCtx, {
          stripeAccountId: "acct_123",
          paymentMethodId: "pm_123",
        }),
      ).rejects.toThrow("setDefaultPaymentMethod is not yet implemented");
    });
  });

  // =========================================================================
  // triggersApi
  // =========================================================================

  describe("triggersApi", () => {
    it("returns correct shape with expected keys", () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const api = bs.triggersApi();

      const expectedSyncKeys = [
        "onAccountCreated",
        "onAccountUpdated",
        "onSubscriptionCreated",
        "onSubscriptionUpdated",
        "onSubscriptionDeleted",
        "onCheckoutSessionCompleted",
        "onProductCreated",
        "onProductUpdated",
        "onPriceCreated",
        "onPriceUpdated",
        "onInvoiceCreated",
        "onInvoiceUpdated",
        "onPaymentCreated",
        "onPayoutCreated",
        "onPayoutUpdated",
      ];

      const expectedAsyncKeys = [
        "afterAccountUpdated",
        "afterCheckoutCompleted",
        "afterSubscriptionUpdated",
        "afterSubscriptionCanceled",
        "afterTrialEnding",
        "afterInvoicePaid",
        "afterPaymentSucceeded",
        "afterPaymentFailed",
        "afterPayoutCompleted",
      ];

      for (const key of [...expectedSyncKeys, ...expectedAsyncKeys]) {
        expect(api).toHaveProperty(key);
      }
    });

    it("sync triggers are Convex function definitions", () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: {
          account: {
            onCreate: vi.fn(),
          },
        },
      });

      const api = bs.triggersApi();

      // internalMutationGeneric returns an object (Convex function definition)
      // Verify the sync trigger entries exist and are truthy (not undefined)
      expect(api.onAccountCreated).toBeDefined();
      expect(api.onAccountUpdated).toBeDefined();
      expect(api.onSubscriptionCreated).toBeDefined();
    });

    it("async hooks are Convex function definitions", () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        hooks: {
          onAccountUpdated: vi.fn(),
          onCheckoutCompleted: vi.fn(),
        },
      });

      const api = bs.triggersApi();

      expect(api.afterAccountUpdated).toBeDefined();
      expect(api.afterCheckoutCompleted).toBeDefined();
      expect(api.afterSubscriptionUpdated).toBeDefined();
    });
  });

  // =========================================================================
  // syncAllAccounts
  // =========================================================================

  describe("syncAllAccounts", () => {
    it("paginates through V2 accounts", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      // First page: has_more = true
      mockStripeInstance.v2.core.accounts.list
        .mockResolvedValueOnce({
          data: [
            {
              id: "acct_1",
              metadata: { userId: "u1" },
              configuration: { customer: { applied: true } },
            },
            {
              id: "acct_2",
              metadata: { userId: "u2" },
              configuration: { customer: { applied: true } },
            },
          ],
          has_more: true,
        })
        // Second page: has_more = false
        .mockResolvedValueOnce({
          data: [
            {
              id: "acct_3",
              metadata: { userId: "u3" },
              configuration: { customer: { applied: true } },
            },
          ],
          has_more: false,
        });

      const result = await bs.syncAllAccounts(mockCtx);

      expect(result.synced).toBe(3);
      expect(result.errorCount).toBe(0);

      // Verify pagination: second call should use starting_after
      expect(mockStripeInstance.v2.core.accounts.list).toHaveBeenCalledTimes(2);
      expect(mockStripeInstance.v2.core.accounts.list).toHaveBeenNthCalledWith(
        2,
        {
          limit: 20,
          starting_after: "acct_2",
        },
      );

      // Verify upsertAccount was called 3 times
      expect(mockCtx.runMutation).toHaveBeenCalledTimes(3);
    });

    it("derives onboarding status from account requirements", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.v2.core.accounts.list.mockResolvedValueOnce({
        data: [
          {
            id: "acct_restricted",
            metadata: { userId: "u_restricted" },
            requirements: {
              entries: [
                {
                  description: "business_type",
                  awaiting_action_from: "user",
                  errors: [],
                  impact: { restricts_capabilities: [] },
                  minimum_deadline: { status: "currently_due" },
                  requested_reasons: [],
                },
                {
                  description: "tos_acceptance",
                  awaiting_action_from: "user",
                  errors: [],
                  impact: { restricts_capabilities: [] },
                  minimum_deadline: { status: "currently_due" },
                  requested_reasons: [],
                },
              ],
              summary: {
                minimum_deadline: { status: "past_due" },
              },
            },
            configuration: {},
          },
        ],
        has_more: false,
      });

      const result = await bs.syncAllAccounts(mockCtx);

      expect(result.synced).toBe(1);
      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        components.betterStripe.core.mutations.upsertAccount,
        expect.objectContaining({
          stripeAccountId: "acct_restricted",
          onboardingStatus: "restricted",
          missingRequirements: expect.arrayContaining([
            "business_type",
            "tos_acceptance",
          ]),
        }),
      );
    });
  });
});
