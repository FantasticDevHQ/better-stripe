// @vitest-environment edge-runtime
/**
 * Tests for `handleWebhookRequest` — the top-level webhook entrypoint that
 * owns request validation, signature verification (routing V1 vs. V2 by event
 * type prefix), the atomic dedup ledger, the sync dispatch into the processor,
 * and the success/failure HTTP contract.
 *
 * We exercise the function DIRECTLY (not via registerRoutes), mocking the
 * Stripe SDK module so `getStripeClient()` yields a controllable client:
 *   - V1 verification → `webhooks.constructEventAsync`
 *   - V2 verification → `parseEventNotificationAsync` (NEVER constructEventAsync;
 *     stripe-node v22 rejects thin payloads passed to constructEventAsync)
 *   - V2 account re-fetch → `v2.core.accounts.retrieve`
 * Every assertion is on the response status/body and on which component
 * mutation/query refs were invoked per branch.
 */
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Component } from "../helpers.js";
import type { RegisterRoutesConfig, WebhookActionCtx } from "../types.js";
import { handleWebhookRequest } from "./handler.js";

// ---------------------------------------------------------------------------
// Stripe SDK mock — one instance, controllable methods
// ---------------------------------------------------------------------------
const mockConstructEventAsync = vi.fn();
const mockParseEventNotificationAsync = vi.fn();
const mockAccountRetrieve = vi.fn();
const mockProductRetrieve = vi.fn();

vi.mock("stripe", () => ({
  default: class StripeMock {
    webhooks = { constructEventAsync: mockConstructEventAsync };
    parseEventNotificationAsync = mockParseEventNotificationAsync;
    v2 = { core: { accounts: { retrieve: mockAccountRetrieve } } };
    products = { retrieve: mockProductRetrieve };
  },
}));

// ---------------------------------------------------------------------------
// Component / ctx / request helpers
// ---------------------------------------------------------------------------
const TO_REF = Symbol.for("toReferencePath");
const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });

function makeComponent(): Component {
  return {
    core: {
      queries: {
        getAccount: ref("core/queries/getAccount"),
        getAccountByStripeId: ref("core/queries/getAccountByStripeId"),
      },
      mutations: {
        upsertAccountInternal: ref("core/mutations/upsertAccountInternal"),
      },
    },
    products: {
      queries: {
        getProductByStripeId: ref("products/queries/getProductByStripeId"),
      },
      mutations: { upsertProduct: ref("products/mutations/upsertProduct") },
    },
    billing: {
      queries: {
        getCheckoutSessionByStripeId: ref(
          "billing/queries/getCheckoutSessionByStripeId",
        ),
        getSubscriptionByStripeId: ref(
          "billing/queries/getSubscriptionByStripeId",
        ),
      },
      mutations: {
        upsertSubscription: ref("billing/mutations/upsertSubscription"),
      },
    },
    webhooks: {
      mutations: {
        insertWebhookEvent: ref("webhooks/mutations/insertWebhookEvent"),
        markWebhookEventProcessed: ref(
          "webhooks/mutations/markWebhookEventProcessed",
        ),
        markWebhookEventFailed: ref(
          "webhooks/mutations/markWebhookEventFailed",
        ),
      },
    },
  } as unknown as Component;
}

function makeCtx(
  overrides?: Partial<WebhookActionCtx>,
): WebhookActionCtx & { runMutation: Mock; runQuery: Mock } {
  return {
    runMutation: vi.fn().mockResolvedValue("inserted"),
    runQuery: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as WebhookActionCtx & { runMutation: Mock; runQuery: Mock };
}

function baseConfig(over?: Partial<RegisterRoutesConfig>): RegisterRoutesConfig {
  return {
    stripeSecretKey: "sk_test_123",
    webhookSecret: "whsec_test",
    ...over,
  } as RegisterRoutesConfig;
}

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request("https://example.com/stripe/webhook", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "stripe-signature": "sig_123",
      "content-type": "application/json",
      ...headers,
    },
  });
}

function makeV1Event(type: string, obj: Record<string, unknown> = {}) {
  return {
    id: "evt_" + Math.random().toString(36).slice(2, 8),
    type,
    livemode: false,
    data: { object: obj },
  };
}

const PRODUCT_OBJ = {
  id: "prod_1",
  name: "Widget",
  description: null,
  active: true,
  metadata: {},
};

function makeThinEvent(over?: Record<string, unknown>) {
  return {
    id: "evt_v2_1",
    type: "v2.core.account.updated",
    created: new Date().toISOString(),
    livemode: false,
    related_object: {
      id: "acct_123",
      type: "v2.core.account",
      url: "/v2/core/accounts/acct_123",
    },
    ...over,
  };
}

function makeAccount(over?: Record<string, unknown>) {
  return {
    id: "acct_123",
    contact_email: "biz@example.com",
    identity: {
      business_details: { registered_name: "Acme Inc" },
      country: "US",
    },
    metadata: { userId: "user_1" },
    requirements: {},
    configuration: { customer: { applied: true } },
    applied_configurations: ["customer"],
    ...over,
  };
}

async function parseBody(res: Response) {
  return JSON.parse(await res.text());
}

let component: Component;
let ctx: WebhookActionCtx & { runMutation: Mock; runQuery: Mock };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  component = makeComponent();
  ctx = makeCtx();
  mockConstructEventAsync.mockResolvedValue(
    makeV1Event("product.created", PRODUCT_OBJ),
  );
});

// Restore the console spies installed above so they don't leak into other files.
afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Request validation / config guards
// ===========================================================================
describe("request validation", () => {
  it("returns 400 when the stripe-signature header is missing", async () => {
    const req = new Request("https://example.com/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "product.created" }),
      headers: { "content-type": "application/json" },
    });
    const res = await handleWebhookRequest(ctx, req, component, baseConfig());
    expect(res.status).toBe(400);
    expect((await parseBody(res)).error).toMatch(/missing stripe-signature/i);
  });

  it("returns 400 for a body that is not valid JSON", async () => {
    const req = makeRequest("not-json{{{");
    const res = await handleWebhookRequest(ctx, req, component, baseConfig());
    expect(res.status).toBe(400);
    expect((await parseBody(res)).error).toMatch(/invalid json/i);
  });

  it("returns 500 when stripeSecretKey is missing from config", async () => {
    const req = makeRequest({ type: "product.created" });
    const res = await handleWebhookRequest(ctx, req, component, {
      webhookSecret: "whsec_test",
    } as RegisterRoutesConfig);
    expect(res.status).toBe(500);
    expect((await parseBody(res)).error).toMatch(/missing stripeSecretKey/i);
  });

  it("returns 500 when webhookSecret is missing from config", async () => {
    const req = makeRequest({ type: "product.created" });
    const res = await handleWebhookRequest(ctx, req, component, {
      stripeSecretKey: "sk_test_123",
    } as RegisterRoutesConfig);
    expect(res.status).toBe(500);
    expect((await parseBody(res)).error).toMatch(/missing webhookSecret/i);
  });
});

// ===========================================================================
// V1 path
// ===========================================================================
describe("V1 events", () => {
  it("returns 400 when constructEventAsync rejects (bad signature)", async () => {
    mockConstructEventAsync.mockRejectedValue(new Error("bad sig"));
    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(400);
    expect((await parseBody(res)).error).toMatch(/signature verification/i);
    // Never reached the ledger.
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("verifies with constructEventAsync (not the thin-event API) and processes the event", async () => {
    const event = makeV1Event("product.created", PRODUCT_OBJ);
    mockConstructEventAsync.mockResolvedValue(event);

    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );

    expect(res.status).toBe(200);
    expect(await parseBody(res)).toEqual({ success: true });
    expect(mockConstructEventAsync).toHaveBeenCalledWith(
      expect.any(String),
      "sig_123",
      "whsec_test",
    );
    expect(mockParseEventNotificationAsync).not.toHaveBeenCalled();

    // Ledger inserted, processor upserted the product, ledger marked processed.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.webhooks.mutations.insertWebhookEvent,
      expect.objectContaining({
        stripeEventId: event.id,
        eventType: "product.created",
        livemode: false,
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.products.mutations.upsertProduct,
      expect.objectContaining({ stripeProductId: "prod_1", name: "Widget" }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.webhooks.mutations.markWebhookEventProcessed,
      { stripeEventId: event.id },
    );
  });

  it("short-circuits to 200 deduplicated when the ledger insert is not 'inserted'", async () => {
    ctx.runMutation.mockResolvedValueOnce("already_processed");
    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(200);
    expect(await parseBody(res)).toEqual({
      success: true,
      deduplicated: true,
    });
    // Did NOT dispatch the processor upsert.
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      component.products.mutations.upsertProduct,
      expect.anything(),
    );
  });

  it("continues processing when the ledger insert throws (best-effort dedup)", async () => {
    ctx.runMutation
      .mockRejectedValueOnce(new Error("ledger down")) // insertWebhookEvent
      .mockResolvedValue("inserted"); // upsert + markProcessed
    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(200);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.products.mutations.upsertProduct,
      expect.objectContaining({ stripeProductId: "prod_1" }),
    );
  });

  it("returns 500 and marks the ledger row failed when the processor throws", async () => {
    const event = makeV1Event("product.created", PRODUCT_OBJ);
    mockConstructEventAsync.mockResolvedValue(event);
    ctx.runMutation
      .mockResolvedValueOnce("inserted") // insertWebhookEvent
      .mockRejectedValueOnce(new Error("DB write failed")) // upsertProduct
      .mockResolvedValueOnce(undefined); // markWebhookEventFailed

    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );

    expect(res.status).toBe(500);
    expect((await parseBody(res)).error).toMatch(/sync processing failed/i);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.webhooks.mutations.markWebhookEventFailed,
      expect.objectContaining({
        stripeEventId: event.id,
        error: "DB write failed",
      }),
    );
  });

  it("still returns 500 when marking the failed ledger row also throws", async () => {
    mockConstructEventAsync.mockResolvedValue(
      makeV1Event("product.created", PRODUCT_OBJ),
    );
    ctx.runMutation
      .mockResolvedValueOnce("inserted") // insertWebhookEvent
      .mockRejectedValueOnce(new Error("processor boom")) // upsertProduct
      .mockRejectedValueOnce(new Error("ledger boom")); // markWebhookEventFailed

    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(500);
  });

  it("still returns 200 when marking the processed ledger row throws", async () => {
    mockConstructEventAsync.mockResolvedValue(
      makeV1Event("product.created", PRODUCT_OBJ),
    );
    ctx.runMutation
      .mockResolvedValueOnce("inserted") // insertWebhookEvent
      .mockResolvedValueOnce(undefined) // upsertProduct
      .mockRejectedValueOnce(new Error("mark processed boom")); // markProcessed

    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(200);
  });

  it("invokes the configured onEvent hook after a successful sync", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const event = makeV1Event("product.created", PRODUCT_OBJ);
    mockConstructEventAsync.mockResolvedValue(event);

    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "product.created" }),
      component,
      baseConfig({ onEvent }),
    );
    expect(res.status).toBe(200);
    expect(onEvent).toHaveBeenCalledWith(ctx, event);
  });

  it("logs an unhandled event type but still returns 200", async () => {
    mockConstructEventAsync.mockResolvedValue(
      makeV1Event("customer.created", { id: "cus_1" }),
    );
    const res = await handleWebhookRequest(
      ctx,
      makeRequest({ type: "customer.created" }),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(200);
    // No domain upsert dispatched.
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      component.products.mutations.upsertProduct,
      expect.anything(),
    );
  });
});

// ===========================================================================
// V2 path
// ===========================================================================
describe("V2 events", () => {
  const v2Req = (thin = makeThinEvent()) =>
    makeRequest(thin, { "stripe-signature": "sig_v2" });

  it("verifies V2 thin events via parseEventNotificationAsync, never constructEventAsync", async () => {
    const thin = makeThinEvent();
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockResolvedValue(makeAccount());

    const res = await handleWebhookRequest(
      ctx,
      v2Req(thin),
      component,
      baseConfig(),
    );

    expect(res.status).toBe(200);
    expect(await parseBody(res)).toEqual({ success: true });
    expect(mockParseEventNotificationAsync).toHaveBeenCalledWith(
      JSON.stringify(thin),
      "sig_v2",
      "whsec_test",
    );
    expect(mockConstructEventAsync).not.toHaveBeenCalled();
    // Account synced + ledger marked processed.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.core.mutations.upsertAccountInternal,
      expect.objectContaining({ stripeAccountId: "acct_123" }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.webhooks.mutations.markWebhookEventProcessed,
      { stripeEventId: thin.id },
    );
  });

  it("uses webhookSecretV2 for thin-event verification when configured", async () => {
    const thin = makeThinEvent();
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockResolvedValue(makeAccount());

    await handleWebhookRequest(
      ctx,
      v2Req(thin),
      component,
      baseConfig({ webhookSecretV2: "whsec_v2_only" }),
    );

    expect(mockParseEventNotificationAsync).toHaveBeenCalledWith(
      JSON.stringify(thin),
      "sig_v2",
      "whsec_v2_only",
    );
  });

  it("returns 400 when thin-event signature verification fails", async () => {
    mockParseEventNotificationAsync.mockRejectedValue(
      new Error("No signatures found"),
    );
    const res = await handleWebhookRequest(
      ctx,
      v2Req(),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(400);
    expect((await parseBody(res)).error).toMatch(/v2 signature/i);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("uses the parsed thin-event id for the dedup ledger entry", async () => {
    const thin = makeThinEvent({ id: "evt_v2_specific" });
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockResolvedValue(makeAccount());

    await handleWebhookRequest(ctx, v2Req(thin), component, baseConfig());

    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.webhooks.mutations.insertWebhookEvent,
      expect.objectContaining({ stripeEventId: "evt_v2_specific" }),
    );
  });

  it("short-circuits to 200 deduplicated for a duplicate V2 event", async () => {
    mockParseEventNotificationAsync.mockResolvedValue({});
    ctx.runMutation.mockResolvedValueOnce("already_processed");
    const res = await handleWebhookRequest(
      ctx,
      v2Req(),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(200);
    expect((await parseBody(res)).deduplicated).toBe(true);
    expect(mockAccountRetrieve).not.toHaveBeenCalled();
  });

  it("continues when the V2 ledger insert throws (best-effort dedup)", async () => {
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockResolvedValue(makeAccount());
    ctx.runMutation
      .mockRejectedValueOnce(new Error("ledger down")) // insertWebhookEvent
      .mockResolvedValue(undefined);
    const res = await handleWebhookRequest(
      ctx,
      v2Req(),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(200);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.core.mutations.upsertAccountInternal,
      expect.objectContaining({ stripeAccountId: "acct_123" }),
    );
  });

  it("returns 500 and marks the ledger failed when the V2 account sync throws", async () => {
    const thin = makeThinEvent();
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockRejectedValue(new Error("Stripe API down"));
    ctx.runMutation
      .mockResolvedValueOnce("inserted") // insertWebhookEvent
      .mockResolvedValueOnce(undefined); // markWebhookEventFailed

    const res = await handleWebhookRequest(
      ctx,
      v2Req(thin),
      component,
      baseConfig(),
    );

    expect(res.status).toBe(500);
    expect((await parseBody(res)).error).toMatch(/v2 account sync failed/i);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.webhooks.mutations.markWebhookEventFailed,
      expect.objectContaining({
        stripeEventId: thin.id,
        error: "Stripe API down",
      }),
    );
  });

  it("still returns 500 when marking the failed V2 ledger row also throws", async () => {
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockRejectedValue(new Error("sync boom"));
    ctx.runMutation
      .mockResolvedValueOnce("inserted") // insertWebhookEvent
      .mockRejectedValueOnce(new Error("ledger boom")); // markWebhookEventFailed

    const res = await handleWebhookRequest(
      ctx,
      v2Req(),
      component,
      baseConfig(),
    );
    expect(res.status).toBe(500);
  });

  it("invokes the onEvent hook with the thin event after a successful V2 sync", async () => {
    const thin = makeThinEvent();
    const onEvent = vi.fn().mockResolvedValue(undefined);
    mockParseEventNotificationAsync.mockResolvedValue({});
    mockAccountRetrieve.mockResolvedValue(makeAccount());

    const res = await handleWebhookRequest(
      ctx,
      v2Req(thin),
      component,
      baseConfig({ onEvent }),
    );
    expect(res.status).toBe(200);
    expect(onEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ id: thin.id, type: thin.type }),
    );
  });
});
