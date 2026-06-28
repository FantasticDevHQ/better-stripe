import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isBetterStripeError } from "./errors.js";
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
        retrieve: vi.fn(),
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
  refunds: {
    create: vi.fn(),
  },
  disputes: {
    update: vi.fn(),
    close: vi.fn(),
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
  accountSessions: {
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

    it("validates platformFee at construction and exposes it", () => {
      const bs = new BetterStripe(components.betterStripe, {
        platformFee: { percent: 10, fixed: 30 },
      });
      expect(bs.platformFee).toEqual({ percent: 10, fixed: 30 });
    });

    it("throws on an invalid platformFee config", () => {
      expect(
        () =>
          new BetterStripe(components.betterStripe, {
            platformFee: { percent: 150 },
          }),
      ).toThrow(/platformFee/);
    });

    it("platformFee is undefined when not configured", () => {
      const bs = new BetterStripe(components.betterStripe);
      expect(bs.platformFee).toBeUndefined();
    });

    it("does not retain or re-expose the caller's mutable fee object", () => {
      const input = { percent: 10, tiers: [{ upTo: null, percent: 10 }] };
      const bs = new BetterStripe(components.betterStripe, {
        platformFee: input,
      });
      // Mutating the original input must not change stored config.
      input.percent = 999;
      input.tiers[0].percent = 999;
      expect(bs.platformFee).toEqual({
        percent: 10,
        tiers: [{ upTo: null, percent: 10 }],
      });
      // Mutating a returned copy must not change internal state either.
      const returned = bs.platformFee!;
      returned.percent = 42;
      expect(bs.platformFee!.percent).toBe(10);
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

  describe("addCustomerConfiguration", () => {
    it("applies the customer configuration and records applied configs", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue({ userId: "user_1" });
      mockStripeInstance.v2.core.accounts.update.mockResolvedValue({});
      mockStripeInstance.v2.core.accounts.retrieve.mockResolvedValue({
        applied_configurations: ["customer"],
      });

      const result = await bs.addCustomerConfiguration(mockCtx, {
        stripeAccountId: "acct_123",
      });

      expect(mockStripeInstance.v2.core.accounts.update).toHaveBeenCalledWith(
        "acct_123",
        { configuration: { customer: {} } },
      );
      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        components.betterStripe.core.mutations.upsertAccount,
        expect.objectContaining({
          stripeAccountId: "acct_123",
          userId: "user_1",
          appliedConfigurations: ["customer"],
        }),
      );
      expect(result).toEqual({
        success: true,
        appliedConfigurations: ["customer"],
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

  describe("updateSubscriptionQuantity", () => {
    it("retrieves the subscription and updates the first item quantity", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: "si_1" }] },
      });
      mockStripeInstance.subscriptionItems.update.mockResolvedValue({});

      const result = await bs.updateSubscriptionQuantity(mockCtx, {
        stripeSubscriptionId: "sub_123",
        quantity: 3,
      });

      expect(mockStripeInstance.subscriptions.retrieve).toHaveBeenCalledWith(
        "sub_123",
      );
      expect(mockStripeInstance.subscriptionItems.update).toHaveBeenCalledWith(
        "si_1",
        { quantity: 3 },
      );
      expect(result).toEqual({ success: true });
    });

    it("rejects when the subscription has no items and does not call update", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        items: { data: [] },
      });

      await expect(
        bs.updateSubscriptionQuantity(mockCtx, {
          stripeSubscriptionId: "sub_123",
          quantity: 3,
        }),
      ).rejects.toThrow("Subscription has no items");

      expect(
        mockStripeInstance.subscriptionItems.update,
      ).not.toHaveBeenCalled();
    });

    it("surfaces a STRIPE_API_ERROR when the retrieve call throws", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockRejectedValue(
        new Error("boom"),
      );

      await expect(
        bs.updateSubscriptionQuantity(mockCtx, {
          stripeSubscriptionId: "sub_123",
          quantity: 3,
        }),
      ).rejects.toMatchObject({ data: { code: "STRIPE_API_ERROR" } });
    });
  });

  describe("cancelSubscription error handling", () => {
    it("surfaces a STRIPE_API_ERROR when the Stripe call throws", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockRejectedValue(
        new Error("boom"),
      );

      await expect(
        bs.cancelSubscription(mockCtx, {
          stripeSubscriptionId: "sub_123",
          cancelAtPeriodEnd: true,
        }),
      ).rejects.toMatchObject({ data: { code: "STRIPE_API_ERROR" } });
    });
  });

  describe("pauseSubscription", () => {
    it("defaults behavior to keep_as_draft when omitted", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      const result = await bs.pauseSubscription(mockCtx, {
        stripeSubscriptionId: "sub_123",
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { pause_collection: { behavior: "keep_as_draft" } },
      );
      expect(result).toEqual({ success: true });
    });

    it("passes resumes_at and behavior when provided", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      await bs.pauseSubscription(mockCtx, {
        stripeSubscriptionId: "sub_123",
        behavior: "void",
        resumesAt: 1893456000,
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { pause_collection: { behavior: "void", resumes_at: 1893456000 } },
      );
    });

    it("surfaces a STRIPE_API_ERROR when the Stripe call throws", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockRejectedValue(
        new Error("boom"),
      );

      await expect(
        bs.pauseSubscription(mockCtx, { stripeSubscriptionId: "sub_123" }),
      ).rejects.toMatchObject({ data: { code: "STRIPE_API_ERROR" } });
    });
  });

  describe("resumeSubscription", () => {
    it("clears pause_collection with the empty-string sentinel", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      const result = await bs.resumeSubscription(mockCtx, {
        stripeSubscriptionId: "sub_123",
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { pause_collection: "" },
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("updateSubscriptionPrice", () => {
    it("retrieves the item id and defaults proration_behavior to none", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: "si_1" }] },
      });
      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      const result = await bs.updateSubscriptionPrice(mockCtx, {
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_new",
      });

      expect(mockStripeInstance.subscriptions.retrieve).toHaveBeenCalledWith(
        "sub_123",
      );
      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        {
          items: [{ id: "si_1", price: "price_new" }],
          proration_behavior: "none",
        },
      );
      expect(result).toEqual({ success: true });
    });

    it("passes through a caller-provided prorationBehavior", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: "si_1" }] },
      });
      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      await bs.updateSubscriptionPrice(mockCtx, {
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_new",
        prorationBehavior: "always_invoice",
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        {
          items: [{ id: "si_1", price: "price_new" }],
          proration_behavior: "always_invoice",
        },
      );
    });

    it("rejects when the subscription has no items and does not call update", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        items: { data: [] },
      });

      await expect(
        bs.updateSubscriptionPrice(mockCtx, {
          stripeSubscriptionId: "sub_123",
          stripePriceId: "price_new",
        }),
      ).rejects.toThrow("Subscription has no items");

      expect(mockStripeInstance.subscriptions.update).not.toHaveBeenCalled();
    });

    it("surfaces a STRIPE_API_ERROR when the update call throws after a successful retrieve", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: "si_1" }] },
      });
      mockStripeInstance.subscriptions.update.mockRejectedValue(
        new Error("boom"),
      );

      await expect(
        bs.updateSubscriptionPrice(mockCtx, {
          stripeSubscriptionId: "sub_123",
          stripePriceId: "price_new",
        }),
      ).rejects.toMatchObject({ data: { code: "STRIPE_API_ERROR" } });
    });
  });

  describe("updateSubscriptionMetadata", () => {
    it("calls update with the provided metadata", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      const result = await bs.updateSubscriptionMetadata(mockCtx, {
        stripeSubscriptionId: "sub_123",
        metadata: { plan: "pro" },
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { metadata: { plan: "pro" } },
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("updateSubscriptionTrialEnd", () => {
    it("ends the trial immediately with 'now'", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      const result = await bs.updateSubscriptionTrialEnd(mockCtx, {
        stripeSubscriptionId: "sub_123",
        trialEnd: "now",
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { trial_end: "now" },
      );
      expect(result).toEqual({ success: true });
    });

    it("passes a numeric timestamp through unchanged", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.update.mockResolvedValue({});

      await bs.updateSubscriptionTrialEnd(mockCtx, {
        stripeSubscriptionId: "sub_123",
        trialEnd: 1893456000,
      });

      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        "sub_123",
        { trial_end: 1893456000 },
      );
    });
  });

  // =========================================================================
  // Invoice methods
  // =========================================================================

  describe("getInvoice", () => {
    it("runs the getInvoiceByStripeId component query with the invoice id", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const fakeInvoice = {
        stripeInvoiceId: "in_123",
        status: "paid",
        amountDue: 1000,
      };
      mockCtx.runQuery.mockResolvedValue(fakeInvoice);

      const result = await bs.getInvoice(mockCtx, {
        stripeInvoiceId: "in_123",
      });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.billing.queries.getInvoiceByStripeId,
        { stripeInvoiceId: "in_123" },
      );
      expect(result).toEqual(fakeInvoice);
    });

    it("returns null when the invoice is not found", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue(null);

      const result = await bs.getInvoice(mockCtx, {
        stripeInvoiceId: "in_missing",
      });

      expect(result).toBeNull();
    });
  });

  describe("getInvoiceByStripeId", () => {
    it("is an alias that runs the same component query", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const fakeInvoice = { stripeInvoiceId: "in_456", status: "open" };
      mockCtx.runQuery.mockResolvedValue(fakeInvoice);

      const result = await bs.getInvoiceByStripeId(mockCtx, {
        stripeInvoiceId: "in_456",
      });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.billing.queries.getInvoiceByStripeId,
        { stripeInvoiceId: "in_456" },
      );
      expect(result).toEqual(fakeInvoice);
    });
  });

  describe("listInvoices", () => {
    it("maps stripeAccountId to the component accountId arg", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listInvoices(mockCtx, {
        stripeAccountId: "acct_map_001",
        status: "paid",
      });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.billing.queries.listInvoices,
        { accountId: "acct_map_001", status: "paid" },
      );
    });

    it("passes no accountId when stripeAccountId is omitted", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listInvoices(mockCtx, { userId: "user_map_001" });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.billing.queries.listInvoices,
        { userId: "user_map_001" },
      );
    });
  });

  describe("listSubscriptions", () => {
    it("maps stripeAccountId to the component accountId arg", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listSubscriptions(mockCtx, {
        stripeAccountId: "acct_map_sub_001",
        status: "active",
      });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.billing.queries.listSubscriptions,
        { accountId: "acct_map_sub_001", status: "active" },
      );
    });

    it("passes no accountId when stripeAccountId is omitted", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listSubscriptions(mockCtx, { status: "canceled" });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.billing.queries.listSubscriptions,
        { status: "canceled" },
      );
    });
  });

  describe("listPayouts", () => {
    it("maps stripeAccountId to the component accountId arg", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listPayouts(mockCtx, {
        stripeAccountId: "acct_map_po_001",
        status: "paid",
      });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.connect.queries.listPayouts,
        { accountId: "acct_map_po_001", status: "paid" },
      );
    });

    it("passes no accountId when stripeAccountId is omitted", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listPayouts(mockCtx, { status: "pending", limit: 10 });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(
        components.betterStripe.connect.queries.listPayouts,
        { status: "pending", limit: 10 },
      );
    });
  });

  // =========================================================================
  // Payout: createPayout
  // =========================================================================

  describe("createPayout", () => {
    it("calls payouts.create with the stripeAccount routing header and default currency", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.payouts.create.mockResolvedValue({ id: "po_1" });

      const result = await bs.createPayout(mockCtx, {
        stripeAccountId: "acct_1",
        amount: 5000,
      });

      expect(mockStripeInstance.payouts.create).toHaveBeenCalledWith(
        { amount: 5000, currency: "usd", metadata: undefined },
        { stripeAccount: "acct_1" },
      );
      expect(result).toEqual({ stripePayoutId: "po_1" });
    });

    it("passes through a currency override and returns stripePayoutId", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.payouts.create.mockResolvedValue({ id: "po_2" });

      const result = await bs.createPayout(mockCtx, {
        stripeAccountId: "acct_1",
        amount: 10000,
        currency: "gbp",
      });

      expect(mockStripeInstance.payouts.create).toHaveBeenCalledWith(
        { amount: 10000, currency: "gbp", metadata: undefined },
        { stripeAccount: "acct_1" },
      );
      expect(result).toEqual({ stripePayoutId: "po_2" });
    });
  });

  // =========================================================================
  // Refund methods
  // =========================================================================

  describe("createRefund", () => {
    it("creates a refund for a payment intent and returns the refund id", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.refunds.create.mockResolvedValue({ id: "re_1" });

      const result = await bs.createRefund(mockCtx, {
        stripePaymentIntentId: "pi_1",
        amount: 250,
        reason: "requested_by_customer",
      });

      expect(mockStripeInstance.refunds.create).toHaveBeenCalledWith(
        {
          payment_intent: "pi_1",
          amount: 250,
          reason: "requested_by_customer",
        },
        undefined,
      );
      expect(result).toEqual({ stripeRefundId: "re_1" });
    });

    it("routes to a connected account when stripeAccountId is given", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.refunds.create.mockResolvedValue({ id: "re_2" });

      await bs.createRefund(mockCtx, {
        stripeChargeId: "ch_1",
        stripeAccountId: "acct_1",
      });

      expect(mockStripeInstance.refunds.create).toHaveBeenCalledWith(
        { charge: "ch_1" },
        { stripeAccount: "acct_1" },
      );
    });

    it("rejects with REFUND_CREATE_FAILED when neither PI nor charge is given", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      await expect(bs.createRefund(mockCtx, {})).rejects.toMatchObject({
        data: { code: "REFUND_CREATE_FAILED" },
      });
      expect(mockStripeInstance.refunds.create).not.toHaveBeenCalled();
    });

    it("rejects with REFUND_CREATE_FAILED when both PI and charge are given", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      await expect(
        bs.createRefund(mockCtx, {
          stripePaymentIntentId: "pi_1",
          stripeChargeId: "ch_1",
        }),
      ).rejects.toMatchObject({ data: { code: "REFUND_CREATE_FAILED" } });
      expect(mockStripeInstance.refunds.create).not.toHaveBeenCalled();
    });

    it("surfaces a STRIPE API failure as REFUND_CREATE_FAILED", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.refunds.create.mockRejectedValue(new Error("boom"));

      await expect(
        bs.createRefund(mockCtx, { stripePaymentIntentId: "pi_1" }),
      ).rejects.toMatchObject({ data: { code: "REFUND_CREATE_FAILED" } });
    });
  });

  describe("listRefunds / getRefundByStripeId", () => {
    it("forwards reads to the component, mapping stripeAccountId to accountId", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockCtx.runQuery.mockResolvedValue([]);

      await bs.listRefunds(mockCtx, {
        stripeAccountId: "acct_1",
        status: "succeeded",
      });

      expect(mockCtx.runQuery).toHaveBeenCalledWith(expect.anything(), {
        accountId: "acct_1",
        status: "succeeded",
      });
    });
  });

  // =========================================================================
  // Dispute methods
  // =========================================================================

  describe("updateDispute", () => {
    it("submits evidence with the submit flag", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.disputes.update.mockResolvedValue({});

      const result = await bs.updateDispute(mockCtx, {
        stripeDisputeId: "dp_1",
        evidence: { product_description: "A widget" },
        submit: true,
      });

      expect(mockStripeInstance.disputes.update).toHaveBeenCalledWith(
        "dp_1",
        { evidence: { product_description: "A widget" }, submit: true },
        undefined,
      );
      expect(result).toEqual({ success: true });
    });

    it("surfaces a STRIPE API failure as DISPUTE_UPDATE_FAILED", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.disputes.update.mockRejectedValue(new Error("boom"));

      await expect(
        bs.updateDispute(mockCtx, { stripeDisputeId: "dp_1", submit: true }),
      ).rejects.toMatchObject({ data: { code: "DISPUTE_UPDATE_FAILED" } });
    });
  });

  describe("closeDispute", () => {
    it("closes the dispute, passing routing options in the third arg", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.disputes.close.mockResolvedValue({});

      const result = await bs.closeDispute(mockCtx, {
        stripeDisputeId: "dp_1",
        stripeAccountId: "acct_1",
      });

      expect(mockStripeInstance.disputes.close).toHaveBeenCalledWith(
        "dp_1",
        {},
        { stripeAccount: "acct_1" },
      );
      expect(result).toEqual({ success: true });
    });
  });

  // =========================================================================
  // Payment method: listPaymentMethods
  // =========================================================================

  describe("listPaymentMethods", () => {
    it("defaults to card type and uses the V2 customer_account param", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.paymentMethods.list.mockResolvedValue({ data: [] });

      await bs.listPaymentMethods(mockCtx, { stripeCustomerId: "acct_1" });

      expect(mockStripeInstance.paymentMethods.list).toHaveBeenCalledWith({
        customer_account: "acct_1",
        type: "card",
      });
    });

    it("passes through an explicit type", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.paymentMethods.list.mockResolvedValue({ data: [] });

      await bs.listPaymentMethods(mockCtx, {
        stripeCustomerId: "acct_1",
        type: "us_bank_account",
      });

      expect(mockStripeInstance.paymentMethods.list).toHaveBeenCalledWith({
        customer_account: "acct_1",
        type: "us_bank_account",
      });
    });
  });

  // =========================================================================
  // Payment method: attachPaymentMethod
  // =========================================================================

  describe("attachPaymentMethod", () => {
    it("attaches with the V2 customer_account param and returns success", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.paymentMethods.attach.mockResolvedValue({});

      const result = await bs.attachPaymentMethod(mockCtx, {
        paymentMethodId: "pm_1",
        stripeCustomerId: "acct_1",
      });

      expect(mockStripeInstance.paymentMethods.attach).toHaveBeenCalledWith(
        "pm_1",
        { customer_account: "acct_1" },
      );
      expect(result).toEqual({ success: true });
    });
  });

  // =========================================================================
  // Payment method: detachPaymentMethod
  // =========================================================================

  describe("detachPaymentMethod", () => {
    it("calls paymentMethods.detach with the payment method id", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.paymentMethods.detach.mockResolvedValue({});

      await bs.detachPaymentMethod(mockCtx, { paymentMethodId: "pm_1" });

      expect(mockStripeInstance.paymentMethods.detach).toHaveBeenCalledWith(
        "pm_1",
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
      ).rejects.toThrow("not yet implemented for V2 Accounts");
    });
  });

  // =========================================================================
  // Account link methods: createAccountSession
  // =========================================================================

  describe("createAccountSession", () => {
    it("calls Stripe accountSessions.create and returns the clientSecret", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.accountSessions.create.mockResolvedValue({
        client_secret: "as_secret_123",
      });

      const result = await bs.createAccountSession(mockCtx, {
        stripeAccountId: "acct_123",
        components: {
          account_management: { enabled: true },
        },
      });

      expect(mockStripeInstance.accountSessions.create).toHaveBeenCalledWith({
        account: "acct_123",
        components: {
          account_management: { enabled: true },
        },
      });
      expect(result).toEqual({ clientSecret: "as_secret_123" });
    });

    it("wraps Stripe failures in a structured STRIPE_API_ERROR", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.accountSessions.create.mockRejectedValue(
        Object.assign(new Error("No such account: acct_missing"), {
          type: "StripeInvalidRequestError",
          code: "resource_missing",
        }),
      );

      const error = await bs
        .createAccountSession(mockCtx, {
          stripeAccountId: "acct_missing",
          components: { account_onboarding: { enabled: true } },
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConvexError);
      expect((error as { data: Record<string, unknown> }).data).toMatchObject({
        code: "STRIPE_API_ERROR",
        stripeError: {
          type: "StripeInvalidRequestError",
          code: "resource_missing",
          message: "No such account: acct_missing",
        },
      });
    });
  });

  // =========================================================================
  // syncAllProducts
  // =========================================================================

  describe("syncAllProducts", () => {
    /** Helper: returns an async iterable from an array (matches Stripe's auto-pagination API). */
    async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) {
        yield item;
      }
    }

    it("calls getProductByStripeId exactly once per distinct product even with multiple prices", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.products.list.mockReturnValue(
        asyncIter([
          {
            id: "prod_1",
            name: "Product 1",
            active: true,
            description: null,
            metadata: {},
          },
        ]),
      );

      // Three prices all belonging to the same product
      mockStripeInstance.prices.list.mockReturnValue(
        asyncIter([
          {
            id: "price_1",
            product: "prod_1",
            active: true,
            currency: "usd",
            unit_amount: 1000,
            type: "one_time",
            recurring: null,
            nickname: null,
            metadata: {},
          },
          {
            id: "price_2",
            product: "prod_1",
            active: true,
            currency: "usd",
            unit_amount: 2000,
            type: "one_time",
            recurring: null,
            nickname: null,
            metadata: {},
          },
          {
            id: "price_3",
            product: "prod_1",
            active: true,
            currency: "usd",
            unit_amount: 3000,
            type: "one_time",
            recurring: null,
            nickname: null,
            metadata: {},
          },
        ]),
      );

      // Resolve query for prod_1 → an internal product
      mockCtx.runQuery.mockResolvedValue({ _id: "internal_prod_1" });
      // runMutation succeeds silently
      mockCtx.runMutation.mockResolvedValue(undefined);

      const result = await bs.syncAllProducts(mockCtx);

      // 1 product upserted + 3 prices upserted
      expect(result.productsSynced).toBe(1);
      expect(result.pricesSynced).toBe(3);

      // getProductByStripeId must have been queried exactly once (cache hit on 2nd/3rd price)
      const queryCallsForGetProduct = mockCtx.runQuery.mock.calls.filter(
        (call) =>
          (call[1] as { stripeProductId?: string } | undefined)
            ?.stripeProductId === "prod_1",
      );
      expect(queryCallsForGetProduct).toHaveLength(1);
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

  // =========================================================================
  // Structured error alignment — one test per converted raw-throw site
  // =========================================================================

  describe("structured error alignment", () => {
    it("createAccountWithOnboarding throws BetterStripeError ACCOUNT_CREATE_FAILED on config error", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      const fakeAccount = {
        id: "acct_err",
        applied_configurations: [],
        configuration: {},
        metadata: {},
        requirements: {
          entries: [],
          summary: { minimum_deadline: { status: "no_requirements" } },
        },
      };
      mockStripeInstance.v2.core.accounts.create.mockResolvedValue(fakeAccount);
      mockStripeInstance.v2.core.accounts.update.mockRejectedValue({
        type: "api_error",
        code: "resource_missing",
        message: "config failed",
      });
      mockCtx.runMutation.mockResolvedValue(undefined);

      let caught: unknown;
      try {
        await bs.createAccountWithOnboarding(mockCtx, {
          userId: "user_123",
          country: "US",
          refreshUrl: "https://example.com/refresh",
          returnUrl: "https://example.com/return",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(isBetterStripeError(caught)).toBe(true);
      const data = (caught as ConvexError<{ code: string; message: string }>)
        .data;
      expect(data.code).toBe("ACCOUNT_CREATE_FAILED");
      expect(data.message).toContain(
        "Failed to apply account configuration after create",
      );
    });

    it("updateSubscriptionQuantity throws BetterStripeError SUBSCRIPTION_UPDATE_FAILED when sub has no items", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.subscriptions.retrieve.mockResolvedValue({
        id: "sub_no_items",
        items: { data: [] },
      });

      let caught: unknown;
      try {
        await bs.updateSubscriptionQuantity(mockCtx, {
          stripeSubscriptionId: "sub_no_items",
          quantity: 2,
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(isBetterStripeError(caught)).toBe(true);
      const data = (caught as ConvexError<{ code: string; message: string }>)
        .data;
      expect(data.code).toBe("SUBSCRIPTION_UPDATE_FAILED");
      expect(data.message).toBe("Subscription has no items");
    });

    it("createPrice throws BetterStripeError PRODUCT_NOT_FOUND when product missing from DB", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      mockStripeInstance.prices.create.mockResolvedValue({
        id: "price_new",
        nickname: null,
        unit_amount: 500,
        currency: "usd",
        active: true,
        metadata: {},
      });
      // runQuery returns null — product not found in component DB
      mockCtx.runQuery.mockResolvedValue(null);

      let caught: unknown;
      try {
        await bs.createPrice(mockCtx, {
          stripeProductId: "prod_missing",
          unitAmount: 500,
          currency: "usd",
          type: "one_time",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(isBetterStripeError(caught)).toBe(true);
      const data = (caught as ConvexError<{ code: string; message: string }>)
        .data;
      expect(data.code).toBe("PRODUCT_NOT_FOUND");
      expect(data.message).toContain("prod_missing");

      // Validate-first: the product is missing, so we must throw BEFORE any
      // Stripe write. Calling prices.create here would orphan a price in
      // Stripe with no corresponding component record (BTS-2).
      expect(mockStripeInstance.prices.create).not.toHaveBeenCalled();
      expect(mockCtx.runMutation).not.toHaveBeenCalled();
    });

    it("setDefaultPaymentMethod throws BetterStripeError PAYMENT_METHOD_FAILED", async () => {
      const bs = new BetterStripe(components.betterStripe, {
        STRIPE_SECRET_KEY: "sk_test_xxx",
      });

      let caught: unknown;
      try {
        await bs.setDefaultPaymentMethod(mockCtx, {
          stripeAccountId: "acct_123",
          paymentMethodId: "pm_123",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(isBetterStripeError(caught)).toBe(true);
      const data = (caught as ConvexError<{ code: string; message: string }>)
        .data;
      expect(data.code).toBe("PAYMENT_METHOD_FAILED");
      expect(data.message).toContain(
        "setDefaultPaymentMethod is not yet implemented",
      );
    });
  });
});
