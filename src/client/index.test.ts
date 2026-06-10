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
    // Registered Convex functions expose their raw handler via `_handler`
    // (set by convex/server's registration impl) — invoke dispatchers that way.
    const invokeHandler = (fn: unknown, ctx: unknown, args: unknown) =>
      (
        fn as { _handler: (ctx: unknown, args: unknown) => Promise<null> }
      )._handler(ctx, args);

    // Component refs expose their function path via the toReferencePath
    // symbol (e.g. "_reference/childComponent/betterStripe/billing/...").
    // Asserting on the path suffix catches typo'd dispatcher spec paths.
    const refPath = (ref: unknown): string =>
      (ref as Record<symbol, string>)[Symbol.for("toReferencePath")];

    it("returns all 18 TriggerApiRefs keys (9 dispatchers + 9 after* hooks)", () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const api = bs.triggersApi();

      const expectedDispatcherKeys = [
        "accountUpserted",
        "productUpserted",
        "priceUpserted",
        "subscriptionUpserted",
        "subscriptionDeleted",
        "checkoutSessionUpserted",
        "invoiceUpserted",
        "paymentUpserted",
        "payoutUpserted",
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

      const allKeys = [...expectedDispatcherKeys, ...expectedAsyncKeys];
      for (const key of allKeys) {
        expect(api, `missing key: ${key}`).toHaveProperty(key);
        expect(
          (api as Record<string, unknown>)[key],
          `key not defined: ${key}`,
        ).toBeDefined();
      }
      expect(allKeys).toHaveLength(18);
    });

    it("subscriptionUpserted upserts and fires onCreate for a new doc", async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate, onUpdate } },
      });

      const newDoc = { stripeSubscriptionId: "sub_1", status: "active" };
      mockCtx.runQuery
        .mockResolvedValueOnce(null) // old doc lookup
        .mockResolvedValueOnce(newDoc); // new doc lookup

      const api = bs.triggersApi();
      await invokeHandler(api.subscriptionUpserted, mockCtx, {
        data: { stripeSubscriptionId: "sub_1", status: "active" },
      });

      // Component upsert performed exactly once, against the right function
      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
      expect(refPath(upsertRef)).toMatch(
        /\/billing\/mutations\/upsertSubscription$/,
      );
      expect(upsertArgs).toEqual({
        stripeSubscriptionId: "sub_1",
        status: "active",
      });
      // Both doc lookups hit the getter with the Stripe id from data
      expect(mockCtx.runQuery).toHaveBeenCalledTimes(2);
      for (const [getterRef, getterArgs] of mockCtx.runQuery.mock.calls) {
        expect(refPath(getterRef)).toMatch(
          /\/billing\/queries\/getSubscriptionByStripeId$/,
        );
        expect(getterArgs).toEqual({ stripeSubscriptionId: "sub_1" });
      }
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith(mockCtx, newDoc);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("subscriptionUpserted fires onUpdate (not onCreate) for an existing doc", async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate, onUpdate } },
      });

      const oldDoc = { stripeSubscriptionId: "sub_1", status: "trialing" };
      const newDoc = { stripeSubscriptionId: "sub_1", status: "active" };
      mockCtx.runQuery
        .mockResolvedValueOnce(oldDoc)
        .mockResolvedValueOnce(newDoc);

      const api = bs.triggersApi();
      await invokeHandler(api.subscriptionUpserted, mockCtx, {
        data: { stripeSubscriptionId: "sub_1", status: "active" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith(mockCtx, newDoc, oldDoc);
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("checkoutSessionUpserted fires onCompleted on transition into 'complete'", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const api = bs.triggersApi();

      const newDoc = { stripeSessionId: "cs_1", status: "complete" };
      mockCtx.runQuery
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "open" })
        .mockResolvedValueOnce(newDoc);

      await invokeHandler(api.checkoutSessionUpserted, mockCtx, {
        data: { stripeSessionId: "cs_1", status: "complete" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(refPath(mockCtx.runMutation.mock.calls[0][0])).toMatch(
        /\/billing\/mutations\/upsertCheckoutSession$/,
      );
      expect(refPath(mockCtx.runQuery.mock.calls[0][0])).toMatch(
        /\/billing\/queries\/getCheckoutSessionByStripeId$/,
      );
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledWith(mockCtx, newDoc);
    });

    it("checkoutSessionUpserted fires onCompleted when first seen already complete (null -> complete)", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const api = bs.triggersApi();

      const newDoc = { stripeSessionId: "cs_1", status: "complete" };
      mockCtx.runQuery
        .mockResolvedValueOnce(null) // no prior doc
        .mockResolvedValueOnce(newDoc);

      await invokeHandler(api.checkoutSessionUpserted, mockCtx, {
        data: { stripeSessionId: "cs_1", status: "complete" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledWith(mockCtx, newDoc);
    });

    it("checkoutSessionUpserted does NOT re-fire onCompleted when already complete", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const api = bs.triggersApi();

      mockCtx.runQuery
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "complete" })
        .mockResolvedValueOnce({
          stripeSessionId: "cs_1",
          status: "complete",
        });

      await invokeHandler(api.checkoutSessionUpserted, mockCtx, {
        data: { stripeSessionId: "cs_1", status: "complete" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it("checkoutSessionUpserted does NOT fire onCompleted when new status is not 'complete'", async () => {
      const onCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { checkoutSession: { onCompleted } },
      });
      const api = bs.triggersApi();

      mockCtx.runQuery
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ stripeSessionId: "cs_1", status: "open" });

      await invokeHandler(api.checkoutSessionUpserted, mockCtx, {
        data: { stripeSessionId: "cs_1", status: "open" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it("subscriptionDeleted upserts and fires subscription.onDelete with the fetched doc", async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onDelete } },
      });
      const api = bs.triggersApi();

      const doc = { stripeSubscriptionId: "sub_1", status: "canceled" };
      mockCtx.runQuery.mockResolvedValueOnce(doc);

      await invokeHandler(api.subscriptionDeleted, mockCtx, {
        data: { stripeSubscriptionId: "sub_1", status: "canceled" },
      });

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      const [upsertRef, upsertArgs] = mockCtx.runMutation.mock.calls[0];
      expect(refPath(upsertRef)).toMatch(
        /\/billing\/mutations\/upsertSubscription$/,
      );
      expect(upsertArgs).toEqual({
        stripeSubscriptionId: "sub_1",
        status: "canceled",
      });
      const [getterRef, getterArgs] = mockCtx.runQuery.mock.calls[0];
      expect(refPath(getterRef)).toMatch(
        /\/billing\/queries\/getSubscriptionByStripeId$/,
      );
      expect(getterArgs).toEqual({ stripeSubscriptionId: "sub_1" });
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith(mockCtx, doc);
    });

    it("rejects with a clear error when the Stripe id field is missing from data", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate: vi.fn() } },
      });
      const api = bs.triggersApi();

      await expect(
        invokeHandler(api.subscriptionUpserted, mockCtx, {
          data: { status: "active" },
        }),
      ).rejects.toThrow(
        "[better-stripe] subscriptionUpserted: missing stripeSubscriptionId in data",
      );

      // Nothing was written or read
      expect(mockCtx.runMutation).not.toHaveBeenCalled();
      expect(mockCtx.runQuery).not.toHaveBeenCalled();
    });

    it("propagates trigger errors so the transaction rolls back", async () => {
      const onCreate = vi.fn().mockRejectedValue(new Error("trigger boom"));
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        triggers: { subscription: { onCreate } },
      });
      const api = bs.triggersApi();

      mockCtx.runQuery
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ stripeSubscriptionId: "sub_1" });

      await expect(
        invokeHandler(api.subscriptionUpserted, mockCtx, {
          data: { stripeSubscriptionId: "sub_1" },
        }),
      ).rejects.toThrow("trigger boom");
    });

    it("performs the upsert without throwing when no triggers are configured", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });
      const api = bs.triggersApi();

      await expect(
        invokeHandler(api.subscriptionUpserted, mockCtx, {
          data: { stripeSubscriptionId: "sub_1" },
        }),
      ).resolves.toBeNull();

      expect(mockCtx.runMutation).toHaveBeenCalledTimes(1);
      // No trigger configured -> the before/after doc reads are skipped
      expect(mockCtx.runQuery).not.toHaveBeenCalled();
    });

    it("afterCheckoutCompleted invokes the configured hook with (ctx, doc)", async () => {
      const onCheckoutCompleted = vi.fn().mockResolvedValue(undefined);
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
        hooks: { onCheckoutCompleted },
      });
      const api = bs.triggersApi();

      const doc = { stripeSessionId: "cs_1", status: "complete" };
      await invokeHandler(api.afterCheckoutCompleted, mockCtx, { doc });

      expect(onCheckoutCompleted).toHaveBeenCalledTimes(1);
      expect(onCheckoutCompleted).toHaveBeenCalledWith(mockCtx, doc);
    });

    it("afterCheckoutCompleted resolves without error when no hook configured", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });
      const api = bs.triggersApi();

      await expect(
        invokeHandler(api.afterCheckoutCompleted, mockCtx, {
          doc: { stripeSessionId: "cs_1" },
        }),
      ).resolves.toBeNull();
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
