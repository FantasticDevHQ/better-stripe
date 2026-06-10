// @vitest-environment edge-runtime
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RegisterRoutesConfig,
  V2ThinEvent,
  WebhookActionCtx,
} from "./types.js";
// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

// We can't call registerRoutes directly because it needs HttpRouter.
// Instead, import the module and extract handleWebhookRequest via registerRoutes.
import { registerRoutes } from "./webhooks.js";

// ---------------------------------------------------------------------------
// Mock Stripe SDK
// ---------------------------------------------------------------------------

const mockConstructEventAsync = vi.fn();
const mockParseEventNotification = vi.fn();
const mockAccountRetrieve = vi.fn();

vi.mock("stripe", () => {
  return {
    default: class StripeMock {
      webhooks = { constructEventAsync: mockConstructEventAsync };
      parseEventNotification = mockParseEventNotification;
      v2 = { core: { accounts: { retrieve: mockAccountRetrieve } } };
      products = { retrieve: vi.fn() };
    },
  };
});

// Mock httpActionGeneric to capture the raw handler
let _capturedHandler:
  | ((ctx: any, request: Request) => Promise<Response>)
  | undefined;

vi.mock("convex/server", () => ({
  httpActionGeneric: (fn: any) => fn,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(
  overrides?: Partial<WebhookActionCtx>,
): WebhookActionCtx {
  return {
    runMutation: vi.fn().mockResolvedValue("inserted"),
    runQuery: vi.fn().mockResolvedValue(null),
    runAction: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const TO_REFERENCE_PATH = Symbol.for("toReferencePath");

function makeRef(path: string) {
  return { [TO_REFERENCE_PATH]: `betterStripe/${path}` };
}

function createMockComponent(): any {
  return {
    core: {
      queries: {
        getAccount: makeRef("core/queries/getAccount"),
        getAccountByStripeId: makeRef("core/queries/getAccountByStripeId"),
        getAccountByUserId: makeRef("core/queries/getAccountByUserId"),
      },
      mutations: {
        upsertAccount: makeRef("core/mutations/upsertAccount"),
        upsertAccountInternal: makeRef("core/mutations/upsertAccountInternal"),
      },
    },
    products: {
      queries: {
        getProductByStripeId: makeRef("products/queries/getProductByStripeId"),
      },
      mutations: {
        upsertProduct: makeRef("products/mutations/upsertProduct"),
        upsertPrice: makeRef("products/mutations/upsertPrice"),
      },
    },
    billing: {
      queries: {
        getCheckoutSessionByStripeId: makeRef(
          "billing/queries/getCheckoutSessionByStripeId",
        ),
      },
      mutations: {
        upsertSubscription: makeRef("billing/mutations/upsertSubscription"),
        upsertCheckoutSession: makeRef(
          "billing/mutations/upsertCheckoutSession",
        ),
        upsertInvoice: makeRef("billing/mutations/upsertInvoice"),
      },
    },
    connect: {
      mutations: {
        upsertPayment: makeRef("connect/mutations/upsertPayment"),
        upsertPayout: makeRef("connect/mutations/upsertPayout"),
      },
    },
    webhooks: {
      mutations: {
        insertWebhookEvent: makeRef("webhooks/mutations/insertWebhookEvent"),
        markWebhookEventProcessed: makeRef(
          "webhooks/mutations/markWebhookEventProcessed",
        ),
        markWebhookEventFailed: makeRef(
          "webhooks/mutations/markWebhookEventFailed",
        ),
      },
    },
  };
}

function makeBaseConfig(
  overrides?: Partial<RegisterRoutesConfig>,
): RegisterRoutesConfig {
  return {
    stripeSecretKey: "sk_test_123",
    webhookSecret: "whsec_test_123",
    ...overrides,
  };
}

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://example.com/stripe/webhook", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "stripe-signature": "test_sig_123",
      "content-type": "application/json",
      ...headers,
    },
  });
}

function makeV1Event(type: string, obj: Record<string, any> = {}): any {
  return {
    id: "evt_test_" + Math.random().toString(36).slice(2, 8),
    type,
    livemode: false,
    data: { object: obj },
  };
}

function makeV2ThinEvent(overrides?: Partial<V2ThinEvent>): V2ThinEvent {
  return {
    id: "evt_v2_test_" + Math.random().toString(36).slice(2, 8),
    type: "v2.core.account.updated",
    created: new Date().toISOString(),
    livemode: false,
    related_object: {
      id: "acct_test_123",
      type: "v2.core.account",
      url: "/v2/core/accounts/acct_test_123",
    },
    ...overrides,
  };
}

/**
 * Capture the webhook handler by calling registerRoutes with a fake HttpRouter.
 * Returns a function that calls the handler directly.
 */
function _setupHandler(
  config?: RegisterRoutesConfig,
): (ctx: WebhookActionCtx, request: Request) => Promise<Response> {
  let handler: any;
  const fakeRouter = {
    route: (opts: any) => {
      handler = opts.handler;
    },
  };

  registerRoutes(
    fakeRouter as any,
    createMockComponent(),
    config ?? makeBaseConfig(),
  );
  return handler;
}

async function parseJson(response: Response): Promise<any> {
  return JSON.parse(await response.text());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("webhooks", () => {
  let ctx: WebhookActionCtx;
  let component: ReturnType<typeof createMockComponent>;
  let handler: (ctx: WebhookActionCtx, request: Request) => Promise<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockCtx();
    component = createMockComponent();

    // Default: constructEventAsync returns a valid V1 event
    mockConstructEventAsync.mockResolvedValue(
      makeV1Event("product.created", {
        id: "prod_123",
        name: "Test",
        active: true,
      }),
    );

    // Set up the handler via registerRoutes, using a fresh component each time
    let rawHandler: any;
    const fakeRouter = {
      route: (opts: any) => {
        rawHandler = opts.handler;
      },
    };
    registerRoutes(fakeRouter as any, component, makeBaseConfig());
    handler = rawHandler;
  });

  // =========================================================================
  // Signature & Parse
  // =========================================================================

  describe("Signature & Parse", () => {
    it("returns 400 for missing stripe-signature header", async () => {
      const request = new Request("https://example.com/stripe/webhook", {
        method: "POST",
        body: JSON.stringify({ type: "product.created" }),
        headers: { "content-type": "application/json" },
        // No stripe-signature header
      });

      const response = await handler(ctx, request);
      expect(response.status).toBe(400);
      const body = await parseJson(response);
      expect(body.error).toMatch(/missing stripe-signature/i);
    });

    it("returns 400 for invalid JSON body", async () => {
      const request = new Request("https://example.com/stripe/webhook", {
        method: "POST",
        body: "not-json{{{{",
        headers: {
          "stripe-signature": "test_sig",
          "content-type": "application/json",
        },
      });

      const response = await handler(ctx, request);
      expect(response.status).toBe(400);
      const body = await parseJson(response);
      expect(body.error).toMatch(/invalid json/i);
    });

    it("returns 400 for failed signature verification", async () => {
      mockConstructEventAsync.mockRejectedValue(
        new Error("Signature verification failed"),
      );

      const request = makeRequest({ type: "product.created", id: "evt_123" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(400);
      const body = await parseJson(response);
      expect(body.error).toMatch(/signature verification failed/i);
    });
  });

  // =========================================================================
  // Dedup
  // =========================================================================

  describe("Dedup", () => {
    it("returns 200 for duplicate event (already processed)", async () => {
      const event = makeV1Event("product.created", {
        id: "prod_123",
        name: "Test",
        active: true,
      });
      mockConstructEventAsync.mockResolvedValue(event);
      (ctx.runMutation as Mock).mockResolvedValueOnce("already_processed");

      const request = makeRequest({ type: "product.created" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);
      const body = await parseJson(response);
      expect(body.deduplicated).toBe(true);
    });

    it("returns 200 for duplicate event (currently processing)", async () => {
      const event = makeV1Event("product.created", {
        id: "prod_123",
        name: "Test",
        active: true,
      });
      mockConstructEventAsync.mockResolvedValue(event);
      (ctx.runMutation as Mock).mockResolvedValueOnce("processing");

      const request = makeRequest({ type: "product.created" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);
      const body = await parseJson(response);
      expect(body.deduplicated).toBe(true);
    });
  });

  // =========================================================================
  // Happy path (V1)
  // =========================================================================

  describe("Happy path", () => {
    it("calls processEvent for valid V1 events", async () => {
      const event = makeV1Event("product.created", {
        id: "prod_123",
        name: "Test Product",
        active: true,
        description: null,
        metadata: {},
      });
      mockConstructEventAsync.mockResolvedValue(event);

      const request = makeRequest({ type: "product.created" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      // Verify upsertProduct was called
      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.products.mutations.upsertProduct,
        expect.objectContaining({
          stripeProductId: "prod_123",
          name: "Test Product",
          active: true,
        }),
      );
    });

    it("returns 500 when processEvent throws", async () => {
      const event = makeV1Event("product.created", {
        id: "prod_123",
        name: "Test",
        active: true,
      });
      mockConstructEventAsync.mockResolvedValue(event);

      // First call: insertWebhookEvent (success)
      // Second call: upsertProduct (throws)
      (ctx.runMutation as Mock)
        .mockResolvedValueOnce("inserted") // insertWebhookEvent
        .mockRejectedValueOnce(new Error("DB write failed")); // upsertProduct

      const request = makeRequest({ type: "product.created" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(500);
      const body = await parseJson(response);
      expect(body.error).toMatch(/sync processing failed/i);
    });

    it("marks event as failed in ledger on error", async () => {
      const event = makeV1Event("product.created", {
        id: "prod_123",
        name: "Test",
        active: true,
      });
      mockConstructEventAsync.mockResolvedValue(event);

      (ctx.runMutation as Mock)
        .mockResolvedValueOnce("inserted") // insertWebhookEvent
        .mockRejectedValueOnce(new Error("DB write failed")) // upsertProduct
        .mockResolvedValueOnce(undefined); // markWebhookEventFailed

      const request = makeRequest({ type: "product.created" });
      await handler(ctx, request);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.webhooks.mutations.markWebhookEventFailed,
        expect.objectContaining({
          stripeEventId: event.id,
          error: "DB write failed",
        }),
      );
    });

    it("runHooks error does not crash handler", async () => {
      const event = makeV1Event("product.created", {
        id: "prod_123",
        name: "Test",
        active: true,
        metadata: {},
      });
      mockConstructEventAsync.mockResolvedValue(event);

      // Re-register with hooks that throw
      let rawHandler: any;
      const fakeRouter = {
        route: (opts: any) => {
          rawHandler = opts.handler;
        },
      };
      registerRoutes(fakeRouter as any, component, {
        ...makeBaseConfig(),
        onEvent: async () => {
          throw new Error("Hook exploded");
        },
      });

      const response = await rawHandler(
        ctx,
        makeRequest({ type: "product.created" }),
      );
      // Handler should still return 200 despite hook error
      expect(response.status).toBe(200);
    });
  });

  // =========================================================================
  // V2 Events
  // =========================================================================

  describe("V2 Events", () => {
    const v2Body = (event: V2ThinEvent) => JSON.stringify(event);

    function makeV2Request(event: V2ThinEvent): Request {
      return new Request("https://example.com/stripe/webhook", {
        method: "POST",
        body: v2Body(event),
        headers: {
          "stripe-signature": "test_sig_v2",
          "content-type": "application/json",
        },
      });
    }

    function setupV2Mocks(accountOverrides?: Record<string, any>) {
      const defaultAccount = {
        id: "acct_test_123",
        contact_email: "test@example.com",
        identity: {
          business_details: { registered_name: "Test Business" },
          country: "US",
        },
        metadata: { userId: "user_123" },
        requirements: {},
        configuration: {
          customer: { applied: true },
        },
        ...accountOverrides,
      };
      mockAccountRetrieve.mockResolvedValue(defaultAccount);
      return defaultAccount;
    }

    it("verifies signature via constructEventAsync", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks();

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      expect(mockConstructEventAsync).toHaveBeenCalledWith(
        v2Body(thinEvent),
        "test_sig_v2",
        "whsec_test_123",
      );
    });

    it("uses parsed body as verified event data", async () => {
      const thinEvent = makeV2ThinEvent({ id: "evt_v2_parsed" });
      mockConstructEventAsync.mockResolvedValue({});
      setupV2Mocks();

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      // The ledger should use the event ID from the parsed body
      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.webhooks.mutations.insertWebhookEvent,
        expect.objectContaining({
          stripeEventId: "evt_v2_parsed",
        }),
      );
    });

    it("duplicate event returns 200", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      (ctx.runMutation as Mock).mockResolvedValueOnce("already_processed");

      const request = makeV2Request(thinEvent);
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);
      const body = await parseJson(response);
      expect(body.deduplicated).toBe(true);
    });

    it("calls upsertAccount mutation", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks();

      const request = makeV2Request(thinEvent);
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.objectContaining({
          stripeAccountId: "acct_test_123",
          userId: "user_123",
          email: "test@example.com",
          name: "Test Business",
        }),
      );
    });

    it("calls onEvent hook", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks();

      const onEvent = vi.fn().mockResolvedValue(undefined);

      let rawHandler: any;
      const fakeRouter = {
        route: (opts: any) => {
          rawHandler = opts.handler;
        },
      };
      registerRoutes(fakeRouter as any, component, {
        ...makeBaseConfig(),
        onEvent,
      });

      const response = await rawHandler(ctx, makeV2Request(thinEvent));
      expect(response.status).toBe(200);
      expect(onEvent).toHaveBeenCalledWith(ctx, thinEvent);
    });

    it("calls typed event handler", async () => {
      const thinEvent = makeV2ThinEvent({ type: "v2.core.account.updated" });
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks();

      const typedHandler = vi.fn().mockResolvedValue(undefined);

      let rawHandler: any;
      const fakeRouter = {
        route: (opts: any) => {
          rawHandler = opts.handler;
        },
      };
      registerRoutes(fakeRouter as any, component, {
        ...makeBaseConfig(),
        events: { "v2.core.account.updated": typedHandler },
      });

      const response = await rawHandler(ctx, makeV2Request(thinEvent));
      expect(response.status).toBe(200);
      expect(typedHandler).toHaveBeenCalledWith(ctx, thinEvent);
    });

    it("marks ledger failed on sync error", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      mockAccountRetrieve.mockRejectedValue(new Error("Stripe API down"));

      (ctx.runMutation as Mock)
        .mockResolvedValueOnce("inserted") // insertWebhookEvent
        .mockResolvedValueOnce(undefined); // markWebhookEventFailed

      const request = makeV2Request(thinEvent);
      const response = await handler(ctx, request);
      expect(response.status).toBe(500);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.webhooks.mutations.markWebhookEventFailed,
        expect.objectContaining({
          stripeEventId: thinEvent.id,
          error: "Stripe API down",
        }),
      );
    });

    it("marks ledger processed on success", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks();

      const request = makeV2Request(thinEvent);
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.webhooks.mutations.markWebhookEventProcessed,
        { stripeEventId: thinEvent.id },
      );
    });

    it("derives pending onboarding status", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks({
        requirements: {},
        configuration: {},
      });

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.objectContaining({
          onboardingStatus: "pending",
        }),
      );
    });

    it("derives in_progress when requirements due", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks({
        requirements: {
          entries: [
            {
              description: "business_url",
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
        },
        configuration: {},
      });

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.objectContaining({
          onboardingStatus: "in_progress",
        }),
      );
    });

    it("derives restricted when deadline is past_due", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks({
        requirements: {
          entries: [
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
      });

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.objectContaining({
          onboardingStatus: "restricted",
        }),
      );
    });

    it("derives complete when configurations applied", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks({
        requirements: {},
        configuration: {
          customer: { applied: true },
          merchant: { applied: true },
        },
      });

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.objectContaining({
          onboardingStatus: "complete",
        }),
      );
    });

    it("persists missingRequirements array", async () => {
      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      setupV2Mocks({
        requirements: {
          entries: [
            {
              description: "business_url",
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
              minimum_deadline: { status: "past_due" },
              requested_reasons: [],
            },
            {
              description: "identity_document",
              awaiting_action_from: "stripe",
              errors: [],
              impact: { restricts_capabilities: [] },
              minimum_deadline: { status: "currently_due" },
              requested_reasons: [],
            },
          ],
        },
        configuration: {},
      });

      const request = makeV2Request(thinEvent);
      await handler(ctx, request);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.objectContaining({
          missingRequirements: expect.arrayContaining([
            "business_url",
            "tos_acceptance",
            "identity_document",
          ]),
        }),
      );
    });
  });

  // =========================================================================
  // Domain routing
  // =========================================================================

  describe("Domain routing", () => {
    it("product events: upserts product via mutation", async () => {
      const event = makeV1Event("product.updated", {
        id: "prod_456",
        name: "Updated Product",
        description: "A description",
        active: false,
        metadata: { tier: "premium" },
      });
      mockConstructEventAsync.mockResolvedValue(event);

      const request = makeRequest({ type: "product.updated" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.products.mutations.upsertProduct,
        expect.objectContaining({
          stripeProductId: "prod_456",
          name: "Updated Product",
          description: "A description",
          active: false,
          metadata: { tier: "premium" },
        }),
      );
    });

    it("subscription events: upserts with trial fields", async () => {
      const trialStart = Math.floor(Date.now() / 1000);
      const trialEnd = trialStart + 14 * 86400;
      const event = makeV1Event("customer.subscription.created", {
        id: "sub_123",
        status: "trialing",
        customer: "cus_abc",
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: trialStart,
        trial_end: trialEnd,
        metadata: { userId: "user_42" },
        items: {
          data: [
            {
              price: { id: "price_123" },
              quantity: 1,
              current_period_start: trialStart,
              current_period_end: trialEnd,
            },
          ],
        },
      });
      mockConstructEventAsync.mockResolvedValue(event);

      const request = makeRequest({ type: "customer.subscription.created" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.billing.mutations.upsertSubscription,
        expect.objectContaining({
          stripeSubscriptionId: "sub_123",
          isTrialing: true,
          trialStart: new Date(trialStart * 1000).toISOString(),
          trialEnd: new Date(trialEnd * 1000).toISOString(),
          userId: "user_42",
        }),
      );
    });

    it("checkout events: merges metadata", async () => {
      const event = makeV1Event("checkout.session.completed", {
        id: "cs_123",
        mode: "subscription",
        status: "complete",
        customer: "cus_abc",
        url: null,
        metadata: { userId: "user_42", plan: "pro" },
      });
      mockConstructEventAsync.mockResolvedValue(event);

      // Simulate existing session with old metadata
      (ctx.runQuery as Mock).mockImplementation(
        async (ref: any, _args: any) => {
          if (
            ref?.[TO_REFERENCE_PATH] ===
            component.billing.queries.getCheckoutSessionByStripeId[
              TO_REFERENCE_PATH
            ]
          ) {
            return { metadata: { previousKey: "old_value" } };
          }
          return null;
        },
      );

      const request = makeRequest({ type: "checkout.session.completed" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.billing.mutations.upsertCheckoutSession,
        expect.objectContaining({
          stripeSessionId: "cs_123",
          metadata: expect.objectContaining({
            previousKey: "old_value",
            userId: "user_42",
            plan: "pro",
          }),
        }),
      );
    });

    it("unhandled event type: logs and returns 200", async () => {
      const event = makeV1Event("some.unknown.event", { id: "obj_999" });
      mockConstructEventAsync.mockResolvedValue(event);

      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      const request = makeRequest({ type: "some.unknown.event" });
      const response = await handler(ctx, request);
      expect(response.status).toBe(200);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled event type: some.unknown.event"),
      );
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // Trigger dispatchers
  // =========================================================================

  describe("Trigger dispatchers", () => {
    /** App-side refs (e.g. internal.stripe.*) are NOT component refs. */
    function makeAppRef(path: string) {
      return { [TO_REFERENCE_PATH]: path };
    }

    function setupHandlerWithTriggers(
      triggers: Record<string, unknown>,
    ): (ctx: WebhookActionCtx, request: Request) => Promise<Response> {
      let rawHandler: any;
      const fakeRouter = {
        route: (opts: any) => {
          rawHandler = opts.handler;
        },
      };
      registerRoutes(fakeRouter as any, component, {
        ...makeBaseConfig(),
        triggers: triggers as any,
      });
      return rawHandler;
    }

    function makeSubscriptionEvent(type: string): any {
      return makeV1Event(type, {
        id: "sub_777",
        status: "active",
        customer: "cus_abc",
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        metadata: { userId: "user_42" },
        items: {
          data: [
            {
              price: { id: "price_123" },
              quantity: 1,
              current_period_start: 1700000000,
              current_period_end: 1702592000,
            },
          ],
        },
      });
    }

    it("routes subscription upsert through triggers.subscriptionUpserted", async () => {
      const subscriptionUpserted = makeAppRef(
        "app/stripe/subscriptionUpserted",
      );
      const triggerHandler = setupHandlerWithTriggers({ subscriptionUpserted });

      const event = makeSubscriptionEvent("customer.subscription.updated");
      mockConstructEventAsync.mockResolvedValue(event);

      const response = await triggerHandler(
        ctx,
        makeRequest({ type: "customer.subscription.updated" }),
      );
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(subscriptionUpserted, {
        data: expect.objectContaining({
          stripeSubscriptionId: "sub_777",
          status: "active",
          userId: "user_42",
          priceId: "price_123",
        }),
      });
      expect(ctx.runMutation).not.toHaveBeenCalledWith(
        component.billing.mutations.upsertSubscription,
        expect.anything(),
      );
    });

    it("falls back to direct component mutation without triggers", async () => {
      const event = makeSubscriptionEvent("customer.subscription.updated");
      mockConstructEventAsync.mockResolvedValue(event);

      const response = await handler(
        ctx,
        makeRequest({ type: "customer.subscription.updated" }),
      );
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.billing.mutations.upsertSubscription,
        expect.objectContaining({
          stripeSubscriptionId: "sub_777",
          status: "active",
        }),
      );
    });

    it("routes subscription deletion through triggers.subscriptionDeleted", async () => {
      const subscriptionUpserted = makeAppRef(
        "app/stripe/subscriptionUpserted",
      );
      const subscriptionDeleted = makeAppRef("app/stripe/subscriptionDeleted");
      const triggerHandler = setupHandlerWithTriggers({
        subscriptionUpserted,
        subscriptionDeleted,
      });

      const event = makeSubscriptionEvent("customer.subscription.deleted");
      mockConstructEventAsync.mockResolvedValue(event);

      const response = await triggerHandler(
        ctx,
        makeRequest({ type: "customer.subscription.deleted" }),
      );
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(subscriptionDeleted, {
        data: expect.objectContaining({ stripeSubscriptionId: "sub_777" }),
      });
      expect(ctx.runMutation).not.toHaveBeenCalledWith(
        subscriptionUpserted,
        expect.anything(),
      );
      expect(ctx.runMutation).not.toHaveBeenCalledWith(
        component.billing.mutations.upsertSubscription,
        expect.anything(),
      );
    });

    it("routes V2 account upsert through triggers.accountUpserted", async () => {
      const accountUpserted = makeAppRef("app/stripe/accountUpserted");
      const triggerHandler = setupHandlerWithTriggers({ accountUpserted });

      const thinEvent = makeV2ThinEvent();
      mockConstructEventAsync.mockResolvedValue(thinEvent);
      mockAccountRetrieve.mockResolvedValue({
        id: "acct_test_123",
        contact_email: "test@example.com",
        identity: {
          business_details: { registered_name: "Test Business" },
          country: "US",
        },
        metadata: { userId: "user_123" },
        requirements: {},
        configuration: { customer: { applied: true } },
      });

      const response = await triggerHandler(ctx, makeRequest(thinEvent));
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(accountUpserted, {
        data: expect.objectContaining({
          stripeAccountId: "acct_test_123",
          userId: "user_123",
          email: "test@example.com",
        }),
      });
      expect(ctx.runMutation).not.toHaveBeenCalledWith(
        component.core.mutations.upsertAccountInternal,
        expect.anything(),
      );
    });

    it("partial triggers: checkout falls back to direct component mutation", async () => {
      const subscriptionUpserted = makeAppRef(
        "app/stripe/subscriptionUpserted",
      );
      const triggerHandler = setupHandlerWithTriggers({ subscriptionUpserted });

      const event = makeV1Event("checkout.session.completed", {
        id: "cs_999",
        mode: "subscription",
        status: "complete",
        customer: "cus_abc",
        url: null,
        metadata: { userId: "user_42" },
      });
      mockConstructEventAsync.mockResolvedValue(event);

      const response = await triggerHandler(
        ctx,
        makeRequest({ type: "checkout.session.completed" }),
      );
      expect(response.status).toBe(200);

      expect(ctx.runMutation).toHaveBeenCalledWith(
        component.billing.mutations.upsertCheckoutSession,
        expect.objectContaining({
          stripeSessionId: "cs_999",
          userId: "user_42",
        }),
      );
      expect(ctx.runMutation).not.toHaveBeenCalledWith(
        subscriptionUpserted,
        expect.anything(),
      );
    });
  });
});
