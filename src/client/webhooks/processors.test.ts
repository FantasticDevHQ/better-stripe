// @vitest-environment edge-runtime
/**
 * Tests for the webhook event processor — the field-normalization surface that
 * turns Stripe wire objects into component upsert payloads. This is the riskiest
 * correctness area in the library: a wrong default or a mishandled
 * string-vs-object union silently corrupts a row with no error. We drive each
 * event type through `processEvent` and assert the EXACT payload handed to the
 * component mutation, covering every union branch, the `userId: ""` sentinel,
 * trial derivation, the payment-status collapse, and the checkout metadata
 * merge.
 *
 * `whCtx` is built WITHOUT `config.webhooks`, so `dispatchUpsert` routes through
 * `ctx.runMutation(componentRef(component, <path>), data)` — letting us read the
 * normalized payload straight off the runMutation mock.
 */
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookContext } from "./helpers.js";
import { processEvent } from "./processors.js";

const TO_REF = Symbol.for("toReferencePath");

/** Fake component exposing every query/mutation ref processors.ts resolves. */
function makeComponent() {
  const ref = (path: string) => ({ [TO_REF]: `betterStripe/${path}` });
  return {
    products: {
      queries: {
        getProductByStripeId: ref("products/queries/getProductByStripeId"),
      },
      mutations: {
        upsertProduct: ref("products/mutations/upsertProduct"),
        upsertPrice: ref("products/mutations/upsertPrice"),
      },
    },
    billing: {
      queries: {
        getCheckoutSessionByStripeId: ref(
          "billing/queries/getCheckoutSessionByStripeId",
        ),
      },
      mutations: {
        upsertSubscription: ref("billing/mutations/upsertSubscription"),
        upsertCheckoutSession: ref("billing/mutations/upsertCheckoutSession"),
        upsertInvoice: ref("billing/mutations/upsertInvoice"),
      },
    },
    connect: {
      mutations: {
        upsertPayment: ref("connect/mutations/upsertPayment"),
        upsertPayout: ref("connect/mutations/upsertPayout"),
      },
    },
  };
}

function makeCtx(opts?: { query?: unknown; queryThrows?: boolean }) {
  const runQuery = vi.fn();
  if (opts?.queryThrows) runQuery.mockRejectedValue(new Error("not found"));
  else runQuery.mockResolvedValue(opts?.query ?? null);
  return {
    runQuery,
    runMutation: vi.fn().mockResolvedValue(undefined),
  };
}

let trCreateSeq = 0;
function makeStripe() {
  return {
    products: { retrieve: vi.fn() },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({}),
    },
    invoices: {
      update: vi.fn().mockResolvedValue({}),
      retrieve: vi.fn(),
    },
    transfers: {
      create: vi.fn(async (_params: unknown) => ({ id: `tr_${++trCreateSeq}` })),
      createReversal: vi.fn(async (_id: unknown) => ({ id: "trr_x" })),
    },
    invoicePayments: {
      list: vi.fn(
        async (_params: unknown): Promise<{ data: Record<string, unknown>[] }> => ({
          data: [{ payment: { charge: "ch_inv" } }],
        }),
      ),
    },
    paymentIntents: {
      retrieve: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    charges: { retrieve: vi.fn() },
  };
}

function makeWhCtx(overrides?: {
  ctx?: ReturnType<typeof makeCtx>;
  stripe?: ReturnType<typeof makeStripe>;
  config?: Record<string, unknown>;
}): WebhookContext & {
  ctx: ReturnType<typeof makeCtx>;
  stripe: ReturnType<typeof makeStripe>;
} {
  const ctx = overrides?.ctx ?? makeCtx();
  const stripe = overrides?.stripe ?? makeStripe();
  return {
    ctx,
    component: makeComponent(),
    stripe,
    webhookSecret: "whsec_test",
    ...(overrides?.config ? { config: overrides.config } : {}),
    // no `config.webhooks` → dispatchUpsert uses the direct component path
  } as unknown as WebhookContext & {
    ctx: ReturnType<typeof makeCtx>;
    stripe: ReturnType<typeof makeStripe>;
  };
}

/** Wrap an object as a minimal Stripe.Event of the given type. */
function event(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

/** The payload + resolved ref path from the Nth runMutation call. */
function dispatchedPayload(ctx: ReturnType<typeof makeCtx>, n = 0) {
  const call = ctx.runMutation.mock.calls[n];
  return { path: call[0][TO_REF] as string, data: call[1] as Record<string, unknown> };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("processEvent — products", () => {
  it("normalizes a product.created event, carrying a Connect account id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("product.created", {
        id: "prod_1",
        account: "acct_connect",
        name: "Widget",
        description: null,
        active: true,
        metadata: { k: "v" },
      }),
    );

    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/products/mutations/upsertProduct");
    expect(data).toEqual({
      stripeProductId: "prod_1",
      accountId: "acct_connect",
      name: "Widget",
      description: undefined,
      active: true,
      metadata: { k: "v" },
    });
  });

  it("leaves accountId undefined when no Connect account is present", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("product.updated", {
        id: "prod_2",
        name: "Gadget",
        description: "d",
        active: false,
        metadata: {},
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.accountId).toBeUndefined();
  });
});

describe("processEvent — prices", () => {
  const price = {
    id: "price_1",
    product: "prod_1",
    nickname: "Monthly",
    unit_amount: 1500,
    currency: "usd",
    active: true,
    type: "recurring",
    recurring: { interval: "month", interval_count: 3 },
    metadata: {},
  };

  it("dispatches a price upsert when the product already exists in the DB", async () => {
    const ctx = makeCtx({ query: { _id: "internal_prod_1" } });
    const whCtx = makeWhCtx({ ctx });

    await processEvent(whCtx, event("price.created", price));

    // last runMutation is the price upsert (no auto-create happened)
    const calls = ctx.runMutation.mock.calls;
    const upsert = calls[calls.length - 1];
    expect(upsert[0][TO_REF]).toBe("betterStripe/products/mutations/upsertPrice");
    expect(upsert[1]).toMatchObject({
      stripePriceId: "price_1",
      productId: "internal_prod_1",
      stripeProductId: "prod_1",
      unitAmount: 1500,
      interval: "month",
      intervalCount: 3,
    });
  });

  it("auto-creates a missing product, then dispatches the price", async () => {
    // first getProductByStripeId → null, second (after create) → the row
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "internal_new" });
    const ctx = {
      runQuery,
      runMutation: vi.fn().mockResolvedValue(undefined),
    };
    const stripe = makeStripe();
    stripe.products.retrieve.mockResolvedValue({
      id: "prod_1",
      name: "Recovered",
      description: null,
      active: true,
      metadata: {},
    });
    const whCtx = makeWhCtx({ ctx: ctx as never, stripe });

    await processEvent(whCtx, event("price.updated", price));

    expect(stripe.products.retrieve).toHaveBeenCalledWith("prod_1");
    // product upsert then price upsert both ran
    const paths = ctx.runMutation.mock.calls.map((c) => c[0][TO_REF]);
    expect(paths).toContain("betterStripe/products/mutations/upsertProduct");
    expect(paths).toContain("betterStripe/products/mutations/upsertPrice");
  });

  it("skips the price (no dispatch) when product auto-create fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx({ query: null });
    const stripe = makeStripe();
    stripe.products.retrieve.mockRejectedValue(new Error("gone"));
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, event("price.created", price));

    // no upsertPrice dispatch happened
    const paths = ctx.runMutation.mock.calls.map((c) => c[0][TO_REF]);
    expect(paths).not.toContain("betterStripe/products/mutations/upsertPrice");
    expect(warn).toHaveBeenCalled();
  });

  it("skips a price with no resolvable product id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx({ query: null });
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(
      whCtx,
      event("price.created", { ...price, product: null }),
    );

    // never even attempted to retrieve a product
    expect(stripe.products.retrieve).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});

describe("processEvent — subscriptions", () => {
  const baseSub = {
    id: "sub_1",
    status: "active",
    customer: "acct_cust",
    cancel_at_period_end: false,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    metadata: { userId: "user_1", orgId: "org_1" },
    items: {
      data: [
        {
          price: { id: "price_x" },
          quantity: 2,
          current_period_start: 1700000000,
          current_period_end: 1702592000,
        },
      ],
    },
  };

  it("normalizes a created subscription with identifiers, trial, period, and price", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.created", baseSub),
    );

    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/billing/mutations/upsertSubscription");
    expect(data).toMatchObject({
      stripeSubscriptionId: "sub_1",
      accountId: "acct_cust",
      userId: "user_1",
      orgId: "org_1",
      status: "active",
      priceId: "price_x",
      quantity: 2,
      cancelAtPeriodEnd: false,
      isTrialing: false,
    });
    expect(data.currentPeriodStart).toBe(
      new Date(1700000000 * 1000).toISOString(),
    );
  });

  it("routes a deleted subscription through the subscriptionDeleted dispatcher", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.deleted", baseSub),
    );
    // both dispatchers map to the same upsertSubscription path, so assert the
    // event still produces exactly one subscription upsert
    expect(whCtx.ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(dispatchedPayload(whCtx.ctx).path).toBe(
      "betterStripe/billing/mutations/upsertSubscription",
    );
  });

  it("derives accountId from an expanded customer object", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.updated", {
        ...baseSub,
        customer: { id: "acct_obj" },
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.accountId).toBe("acct_obj");
  });

  it("prefers the V2 customer_account over the legacy customer id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.created", {
        ...baseSub,
        customer: "cus_legacy",
        customer_account: "acct_v2",
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.accountId).toBe("acct_v2");
  });

  it("falls back to the empty-string userId sentinel when metadata is absent", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.updated", { ...baseSub, metadata: null }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.userId).toBe("");
    expect(data.orgId).toBeUndefined();
  });

  it("leaves price/period/quantity undefined when the subscription has no items", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.updated", {
        ...baseSub,
        items: { data: [] },
      }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.priceId).toBeUndefined();
    expect(data.quantity).toBeUndefined();
    expect(data.currentPeriodStart).toBeUndefined();
  });

  it("marks a trialing subscription and converts the trial epochs", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("customer.subscription.trial_will_end", {
        ...baseSub,
        status: "trialing",
        trial_start: 1700000000,
        trial_end: 1700600000,
      }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.isTrialing).toBe(true);
    expect(data.trialEnd).toBe(new Date(1700600000 * 1000).toISOString());
  });

  // BTS-33: when a recurring charge fails, Stripe drives the subscription to
  // `past_due` (then `unpaid` once retries are exhausted) via
  // customer.subscription.updated. The raw delinquent status must reach the
  // table unchanged so `onSubscriptionUpdated` consumers can act on it.
  it.each(["past_due", "unpaid"] as const)(
    "passes through the delinquent subscription status %s",
    async (status) => {
      const whCtx = makeWhCtx();
      await processEvent(
        whCtx,
        event("customer.subscription.updated", { ...baseSub, status }),
      );
      expect(dispatchedPayload(whCtx.ctx).data.status).toBe(status);
    },
  );
});

describe("processEvent — checkout", () => {
  const session = {
    id: "cs_1",
    customer: "acct_c",
    mode: "subscription",
    status: "complete",
    client_secret: "cs_secret",
    url: "https://pay",
    metadata: { userId: "user_1", new: "fromEvent" },
    line_items: { data: [{ price: { id: "price_co" } }] },
  };

  it("merges stored metadata with event metadata (event wins on conflicts)", async () => {
    const ctx = makeCtx({
      query: { metadata: { stored: "fromDb", new: "old" } },
    });
    const whCtx = makeWhCtx({ ctx });

    await processEvent(whCtx, event("checkout.session.completed", session));

    const calls = ctx.runMutation.mock.calls;
    const upsert = calls[calls.length - 1];
    expect(upsert[0][TO_REF]).toBe(
      "betterStripe/billing/mutations/upsertCheckoutSession",
    );
    expect(upsert[1]).toMatchObject({
      stripeSessionId: "cs_1",
      priceId: "price_co",
      mode: "subscription",
      status: "complete",
      metadata: { stored: "fromDb", new: "fromEvent", userId: "user_1" },
    });
  });

  it("uses only event metadata when the session is seen for the first time", async () => {
    const ctx = makeCtx({ queryThrows: true });
    const whCtx = makeWhCtx({ ctx });

    await processEvent(whCtx, event("checkout.session.completed", session));

    const calls = ctx.runMutation.mock.calls;
    const upsert = calls[calls.length - 1];
    expect(upsert[1].metadata).toEqual({ userId: "user_1", new: "fromEvent" });
  });

  it("prefers the V2 customer_account over the legacy customer id", async () => {
    const ctx = makeCtx({ queryThrows: true });
    const whCtx = makeWhCtx({ ctx });

    await processEvent(
      whCtx,
      event("checkout.session.completed", {
        ...session,
        customer: "cus_legacy",
        customer_account: "acct_v2",
      }),
    );

    const calls = ctx.runMutation.mock.calls;
    const upsert = calls[calls.length - 1];
    expect(upsert[1].accountId).toBe("acct_v2");
  });
});

describe("processEvent — invoices", () => {
  it("normalizes an invoice and resolves the parent subscription id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("invoice.paid", {
        id: "in_1",
        customer: "acct_i",
        currency: "usd",
        amount_due: 1000,
        amount_paid: 1000,
        status: "paid",
        period_start: 1700000000,
        period_end: 1702592000,
        hosted_invoice_url: "https://inv",
        invoice_pdf: "https://pdf",
        metadata: {},
        parent: { subscription_details: { subscription: "sub_parent" } },
      }),
    );

    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/billing/mutations/upsertInvoice");
    expect(data).toMatchObject({
      stripeInvoiceId: "in_1",
      accountId: "acct_i",
      subscriptionId: "sub_parent",
      status: "paid",
      amountDue: 1000,
      amountPaid: 1000,
    });
  });

  it("defaults a missing invoice status to draft, derives accountId from an expanded customer, and leaves subscriptionId undefined", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("invoice.created", {
        id: "in_2",
        customer: { id: "acct_obj_i" },
        currency: "usd",
        amount_due: 0,
        amount_paid: 0,
        status: null,
        period_start: null,
        period_end: null,
        metadata: {},
      }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.status).toBe("draft");
    expect(data.accountId).toBe("acct_obj_i");
    expect(data.subscriptionId).toBeUndefined();
  });

  it("prefers the V2 customer_account over the legacy customer id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("invoice.paid", {
        id: "in_3",
        customer: "cus_legacy",
        customer_account: "acct_v2",
        currency: "usd",
        amount_due: 0,
        amount_paid: 0,
        status: "paid",
        period_start: null,
        period_end: null,
        metadata: {},
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.accountId).toBe("acct_v2");
  });

  // BTS-33: a failed subscription charge transitions the invoice (Stripe leaves
  // it `open` for retry) and carries the smart-retry schedule so a dunning hook
  // can surface when Stripe will try again.
  it("transitions state and surfaces retry metadata on invoice.payment_failed", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("invoice.payment_failed", {
        id: "in_failed",
        customer: "acct_i",
        currency: "usd",
        amount_due: 5000,
        amount_paid: 0,
        status: "open",
        attempt_count: 1,
        next_payment_attempt: 1700003600,
        period_start: null,
        period_end: null,
        metadata: {},
        parent: { subscription_details: { subscription: "sub_delinquent" } },
      }),
    );

    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/billing/mutations/upsertInvoice");
    expect(data).toMatchObject({
      stripeInvoiceId: "in_failed",
      subscriptionId: "sub_delinquent",
      status: "open",
      amountPaid: 0,
      attemptCount: 1,
    });
    expect(data.nextPaymentAttempt).toBe(
      new Date(1700003600 * 1000).toISOString(),
    );
  });
});

describe("processEvent — payments (status collapse)", () => {
  const base = {
    id: "pi_1",
    customer: "acct_p",
    amount: 2000,
    currency: "usd",
    metadata: {},
  };

  it.each([
    ["succeeded", "succeeded"],
    ["canceled", "canceled"],
    ["processing", "processing"],
    ["requires_action", "requires_action"],
    ["requires_confirmation", "requires_action"],
    ["requires_payment_method", "requires_action"],
    ["requires_capture", "requires_action"],
  ])("maps Stripe status %s to app status %s", async (stripeStatus, expected) => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.succeeded", { ...base, status: stripeStatus }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.status).toBe(expected);
  });

  it("maps any unrecognized status to failed", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.payment_failed", {
        ...base,
        status: "some_new_state",
      }),
    );
    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/connect/mutations/upsertPayment");
    expect(data.status).toBe("failed");
  });

  it("prefers the V2 customer_account over the legacy customer id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.succeeded", {
        ...base,
        customer: "cus_legacy",
        customer_account: "acct_v2",
        status: "succeeded",
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.accountId).toBe("acct_v2");
  });
});

describe("processEvent — payouts", () => {
  it("normalizes a payout, taking destination as a string id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payout.paid", {
        id: "po_1",
        destination: "ba_123",
        amount: 5000,
        currency: "usd",
        status: "paid",
        arrival_date: 1700000000,
        method: "standard",
        metadata: {},
      }),
    );
    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/connect/mutations/upsertPayout");
    expect(data).toMatchObject({
      stripePayoutId: "po_1",
      accountId: "ba_123",
      amount: 5000,
      status: "paid",
      method: "standard",
    });
  });

  it("falls back to an empty-string accountId for an expanded destination without id", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payout.failed", {
        id: "po_2",
        destination: {},
        amount: 100,
        currency: "usd",
        status: "failed",
        arrival_date: null,
        metadata: {},
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.accountId).toBe("");
  });
});

describe("processEvent — unhandled", () => {
  it("logs and dispatches nothing for an unknown event type", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const whCtx = makeWhCtx();
    await processEvent(whCtx, event("customer.created", { id: "cus_1" }));
    expect(whCtx.ctx.runMutation).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Unhandled event type: customer.created"),
    );
  });
});

describe("processEvent — fee & transfer capture (BTS-20)", () => {
  it("denormalizes application_fee + transfer destination onto a payment", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.succeeded", {
        id: "pi_fee",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        application_fee_amount: 1000,
        transfer_data: { destination: "acct_store" },
        metadata: {},
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data).toMatchObject({
      stripePaymentIntentId: "pi_fee",
      chargeType: "destination",
      destinationAccountId: "acct_store",
      applicationFeeAmount: 1000,
      feeCollectedAmount: 1000,
    });
  });

  it("handles a transfer destination given as an expanded object", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.succeeded", {
        id: "pi_fee2",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        transfer_data: { destination: { id: "acct_store" } },
        metadata: {},
      }),
    );
    expect(dispatchedPayload(whCtx.ctx).data.destinationAccountId).toBe(
      "acct_store",
    );
  });

  it("leaves fee fields unset for a plain payment", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.succeeded", {
        id: "pi_plain",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        metadata: {},
      }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.chargeType).toBeUndefined();
    expect(data.destinationAccountId).toBeUndefined();
    expect(data.applicationFeeAmount).toBeUndefined();
  });

  it("does not denormalize fees for a non-succeeded payment intent", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("payment_intent.payment_failed", {
        id: "pi_failed",
        amount: 10000,
        currency: "usd",
        status: "requires_payment_method",
        application_fee_amount: 1000,
        transfer_data: { destination: "acct_store" },
        metadata: {},
      }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.status).toBe("requires_action"); // requires_payment_method → requires_action
    expect(data.feeCollectedAmount).toBeUndefined();
    expect(data.applicationFeeAmount).toBeUndefined();
    expect(data.destinationAccountId).toBeUndefined();
    expect(data.chargeType).toBeUndefined();
  });

  // Note: the platform fee lives on the charge/PaymentIntent, not the typed
  // Stripe.Invoice, so fee denormalization is captured on the `payments` row
  // (above) rather than the invoice.
});

describe("processEvent — split transfer engine (BTS-22)", () => {
  it("fans funds out to recipients on a separate-charges payment_intent.succeeded", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("payment_intent.succeeded", {
        id: "pi_split",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        latest_charge: "ch_split",
        metadata: {
          bsChargeType: "separate",
          bsFeeConfig: JSON.stringify({ percent: 10 }),
          bsSplit: JSON.stringify([
            { destinationAccountId: "acct_store", role: "store", percent: 80 },
            { destinationAccountId: "acct_aff", role: "affiliate", percent: 5 },
          ]),
        },
      }),
    );

    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.create.mock.calls[0][0]).toMatchObject({
      amount: 8000,
      destination: "acct_store",
      source_transaction: "ch_split",
    });
    expect(stripe.transfers.create.mock.calls[1][0]).toMatchObject({
      amount: 500,
      destination: "acct_aff",
    });
  });

  it("throws (not silently skips) when a separate sale has no latest_charge", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(
        whCtx,
        event("payment_intent.succeeded", {
          id: "pi_nocharge",
          amount: 10000,
          currency: "usd",
          status: "succeeded",
          latest_charge: null,
          metadata: {
            bsChargeType: "separate",
            bsSplit: JSON.stringify([
              { destinationAccountId: "acct_store", role: "store", percent: 90 },
            ]),
          },
        }),
      ),
    ).rejects.toThrow(/latest_charge|transfer/i);
  });

  it("throws when a separate sale has malformed bsSplit metadata", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(
        whCtx,
        event("payment_intent.succeeded", {
          id: "pi_badjson",
          amount: 10000,
          currency: "usd",
          status: "succeeded",
          latest_charge: "ch_x",
          metadata: { bsChargeType: "separate", bsSplit: "{not-json" },
        }),
      ),
    ).rejects.toThrow(/malformed/i);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("splits a recurring subscription invoice on invoice.paid (BTS-52)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsChargeType: "separate",
        bsFeeConfig: JSON.stringify({ percent: 10 }),
        bsSplit: JSON.stringify([
          { destinationAccountId: "acct_store", role: "store", percent: 80 },
          { destinationAccountId: "acct_aff", role: "affiliate", percent: 5 },
        ]),
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.paid", {
        id: "in_1",
        currency: "usd",
        amount_due: 10000,
        amount_paid: 10000,
        status: "paid",
        metadata: {},
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    );

    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.create.mock.calls[0][0]).toMatchObject({
      amount: 8000,
      destination: "acct_store",
      source_transaction: "ch_inv",
    });
    expect(stripe.transfers.create.mock.calls[1][0]).toMatchObject({
      amount: 500,
      destination: "acct_aff",
    });
  });

  it("skips a zero-amount invoice without throwing (no charge to split)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsChargeType: "separate",
        bsSplit: JSON.stringify([
          { destinationAccountId: "acct_store", role: "store", percent: 80 },
        ]),
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.paid", {
        id: "in_zero",
        currency: "usd",
        amount_due: 0,
        amount_paid: 0, // 100%-off coupon / credit → no charge
        status: "paid",
        metadata: {},
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    );
    // No charge resolution, no transfers, no throw.
    expect(stripe.invoicePayments.list).not.toHaveBeenCalled();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("does not split a normal (non-separate) subscription invoice", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({ id: "sub_1", metadata: {} });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.paid", {
        id: "in_2",
        currency: "usd",
        amount_due: 10000,
        amount_paid: 10000,
        status: "paid",
        metadata: {},
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("[BTS-27] claws back the charge's transfers on charge.dispute.created", async () => {
    const stripe = makeStripe();
    // The charge funded a store + affiliate transfer.
    const ctx = makeCtx({
      query: [
        { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000 },
        { stripeTransferId: "tr_aff", destinationAccountId: "acct_aff", role: "affiliate", amount: 1000 },
      ],
    });
    const whCtx = makeWhCtx({ stripe, ctx });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_1",
        charge: "ch_1",
        amount: 9000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );

    // Both recipient transfers reversed, with the dispute id as the idempotency op.
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_store",
      { amount: 8000 },
      { idempotencyKey: "bs_rev_dp_1_tr_store" },
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_aff",
      { amount: 1000 },
      { idempotencyKey: "bs_rev_dp_1_tr_aff" },
    );
  });

  it("does not claw back transfers on a dispute that isn't newly created", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx({
      query: [
        { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000 },
      ],
    });
    const whCtx = makeWhCtx({ stripe, ctx });

    await processEvent(
      whCtx,
      event("charge.dispute.updated", {
        id: "dp_2",
        charge: "ch_1",
        amount: 8000,
        currency: "usd",
        status: "under_review",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("[BTS-29] reinstates transfers when a dispute closes as won", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx({
      query: [
        { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000, currency: "usd", reversedAmount: 8000 },
      ],
    });
    const whCtx = makeWhCtx({ stripe, ctx });

    await processEvent(
      whCtx,
      event("charge.dispute.closed", {
        id: "dp_1",
        charge: "ch_1",
        amount: 8000,
        currency: "usd",
        status: "won",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );

    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, destination: "acct_store" }),
      { idempotencyKey: "bs_reinstate_dp_1_acct_store_store" },
    );
  });

  it("[BTS-29] does not reinstate when a dispute closes as lost", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx({
      query: [
        { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 8000, currency: "usd", reversedAmount: 8000 },
      ],
    });
    const whCtx = makeWhCtx({ stripe, ctx });

    await processEvent(
      whCtx,
      event("charge.dispute.closed", {
        id: "dp_2",
        charge: "ch_1",
        amount: 8000,
        currency: "usd",
        status: "lost",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("[BTS-28] cancels the disputed subscription at period end (default)", async () => {
    const stripe = makeStripe();
    stripe.invoicePayments.list.mockResolvedValue({
      data: [{ invoice: "in_1", payment: { charge: "ch_1" } }],
    });
    stripe.invoices.retrieve.mockResolvedValue({
      id: "in_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_1",
        charge: "ch_1",
        payment_intent: "pi_1",
        amount: 5000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );

    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: true },
      { idempotencyKey: "bs_dispute_cancel_dp_1" },
    );
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("[BTS-28] does not cancel when autoCancelOnDispute is off", async () => {
    const stripe = makeStripe();
    stripe.invoicePayments.list.mockResolvedValue({
      data: [{ invoice: "in_1", payment: { charge: "ch_1" } }],
    });
    stripe.invoices.retrieve.mockResolvedValue({
      id: "in_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    const whCtx = makeWhCtx({ stripe, config: { autoCancelOnDispute: false } });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_2",
        charge: "ch_1",
        payment_intent: "pi_1",
        amount: 5000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("[BTS-28] cancels immediately when configured", async () => {
    const stripe = makeStripe();
    stripe.invoicePayments.list.mockResolvedValue({
      data: [{ invoice: "in_1", payment: { charge: "ch_1" } }],
    });
    stripe.invoices.retrieve.mockResolvedValue({
      id: "in_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    const whCtx = makeWhCtx({
      stripe,
      config: { cancelDisputedSubscriptionImmediately: true },
    });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_3",
        charge: "ch_1",
        payment_intent: "pi_1",
        amount: 5000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_1",
      undefined,
      { idempotencyKey: "bs_dispute_cancel_dp_3" },
    );
  });

  it("[BTS-26] stores the charge's statement descriptor on the dispute", async () => {
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      calculated_statement_descriptor: "ACME STORE",
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_desc",
        charge: "ch_1",
        amount: 5000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );
    const { data } = dispatchedPayload(whCtx.ctx);
    expect(data.statementDescriptor).toBe("ACME STORE");
  });

  it("[BTS-26] still processes the dispute when the charge lookup fails (descriptor is best-effort)", async () => {
    const stripe = makeStripe();
    stripe.charges.retrieve.mockRejectedValue(new Error("stripe down"));
    const ctx = makeCtx({
      query: [
        { stripeTransferId: "tr_store", destinationAccountId: "acct_store", role: "store", amount: 9000 },
      ],
    });
    const whCtx = makeWhCtx({ stripe, ctx });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_bf",
        charge: "ch_1",
        amount: 9000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );

    // Dispute still recorded (without a descriptor) and clawback still ran.
    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/connect/mutations/upsertDispute");
    expect(data.statementDescriptor).toBeUndefined();
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  it("[BTS-27] claws back a single-recipient transfer on dispute", async () => {
    const stripe = makeStripe();
    const ctx = makeCtx({
      query: [
        { stripeTransferId: "tr_only", destinationAccountId: "acct_store", role: "store", amount: 9000 },
      ],
    });
    const whCtx = makeWhCtx({ stripe, ctx });

    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_single",
        charge: "ch_1",
        amount: 9000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );

    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_only",
      { amount: 9000 },
      { idempotencyKey: "bs_rev_dp_single_tr_only" },
    );
  });

  it("[BTS-26] populates evidenceDueBy from the dispute's evidence_details", async () => {
    const whCtx = makeWhCtx();
    await processEvent(
      whCtx,
      event("charge.dispute.created", {
        id: "dp_1",
        charge: "ch_1",
        payment_intent: "pi_1",
        amount: 5000,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1700000000 },
        metadata: {},
      }),
    );
    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/connect/mutations/upsertDispute");
    expect(data.evidenceDueBy).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("does not create transfers for a normal (non-split) payment", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("payment_intent.succeeded", {
        id: "pi_plain",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        latest_charge: "ch_plain",
        metadata: {},
      }),
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("processEvent — per-invoice statement descriptor (BTS-32)", () => {
  const subInvoice = (overrides: Record<string, unknown> = {}) => ({
    id: "in_sd",
    customer: "acct_buyer",
    currency: "usd",
    amount_due: 10000,
    amount_paid: 0,
    status: "draft",
    metadata: {},
    parent: { subscription_details: { subscription: "sub_sd" } },
    ...overrides,
  });

  it("sets the invoice statement_descriptor from the subscription's bsStatementDescriptor marker", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_sd",
      metadata: { bsStatementDescriptor: "MAYAS FITNESS" },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", subInvoice()));

    expect(stripe.invoices.update).toHaveBeenCalledWith("in_sd", {
      statement_descriptor: "MAYAS FITNESS",
    });
  });

  it("coexists with the per-invoice fee: both updates land on a doubly-flagged subscription", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_sd",
      metadata: {
        bsFeeMode: "per_invoice",
        bsFeeConfig: JSON.stringify({ percent: 2.9, fixed: 30 }),
        bsStatementDescriptor: "MAYAS FITNESS",
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", subInvoice()));

    expect(stripe.invoices.update).toHaveBeenCalledWith("in_sd", {
      application_fee_amount: 320,
      metadata: { bsFeeApplied: "1" },
    });
    expect(stripe.invoices.update).toHaveBeenCalledWith("in_sd", {
      statement_descriptor: "MAYAS FITNESS",
    });
  });

  it("does nothing when the subscription carries no descriptor marker", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_sd",
      metadata: {},
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", subInvoice()));
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("never overwrites an already-set statement_descriptor (idempotent on retries)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_sd",
      metadata: { bsStatementDescriptor: "MAYAS FITNESS" },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event(
        "invoice.created",
        subInvoice({ statement_descriptor: "APP SET THIS" }),
      ),
    );
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("skips a marker that fails defensive validation instead of sending it to Stripe", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_sd",
      // Should be impossible (validated at set time) but webhooks are
      // defensive: never forward a rule-breaking descriptor.
      metadata: { bsStatementDescriptor: "BAD*NAME" },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", subInvoice()));
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("never breaks invoice processing when the descriptor update fails (cosmetic, reconciled next cycle)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_sd",
      metadata: { bsStatementDescriptor: "MAYAS FITNESS" },
    });
    stripe.invoices.update.mockRejectedValue(new Error("stripe down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(whCtx, event("invoice.created", subInvoice())),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    // The invoice row still lands in the component DB.
    const paths = (whCtx.ctx.runMutation as ReturnType<typeof vi.fn>).mock.calls;
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe("processEvent — per-invoice fixed/tier fee (BTS-51)", () => {
  const flaggedInvoice = (overrides: Record<string, unknown> = {}) => ({
    id: "in_fee",
    customer: "acct_buyer",
    currency: "usd",
    amount_due: 10000,
    amount_paid: 0,
    status: "draft",
    metadata: {},
    parent: { subscription_details: { subscription: "sub_1" } },
    ...overrides,
  });

  it("applies a fixed/tier application_fee_amount on invoice.created for a flagged subscription", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsFeeMode: "per_invoice",
        bsFeeConfig: JSON.stringify({ percent: 2.9, fixed: 30 }),
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", flaggedInvoice()));

    // round(10000 * 0.029) + 30 = 320
    expect(stripe.invoices.update).toHaveBeenCalledWith("in_fee", {
      application_fee_amount: 320,
      metadata: { bsFeeApplied: "1" },
    });
  });

  it("does nothing for a subscription that is not flagged", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {},
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", flaggedInvoice()));
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("is idempotent — skips invoices already marked bsFeeApplied", async () => {
    const stripe = makeStripe();
    // The BTS-32 descriptor processor shares this event and may retrieve the
    // subscription; give it an unflagged sub so only the fee path is observed.
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {},
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.created", flaggedInvoice({ metadata: { bsFeeApplied: "1" } })),
    );
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("does not send a non-finite fee from a shape-invalid config", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsFeeMode: "per_invoice",
        // No `percent` → computeFee returns NaN; must not reach Stripe.
        bsFeeConfig: JSON.stringify({ fixed: 30 }),
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.created", flaggedInvoice()));
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("does nothing for an invoice with no parent subscription", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.created", flaggedInvoice({ parent: null })),
    );
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  // BTS-68: the first subscription invoice is finalized (`open`) synchronously at
  // creation, so `invoice.created` fires with a NON-draft invoice and the
  // `invoices.update` that applies the fee is rejected by Stripe (monetary values
  // are uneditable once finalized). This characterizes the silent miss the fix
  // must compensate for elsewhere — it must not crash the webhook.
  it("silently no-ops (no crash) when the first invoice is already finalized at invoice.created", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsFeeMode: "per_invoice",
        bsFeeConfig: JSON.stringify({ percent: 2.9, fixed: 30 }),
      },
    });
    // Stripe rejects a monetary update on a finalized invoice.
    stripe.invoices.update.mockRejectedValue(
      new Error("This invoice is no longer a draft."),
    );
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(
        whCtx,
        event("invoice.created", flaggedInvoice({ status: "open" })),
      ),
    ).resolves.toBeUndefined();
    // The fee was NOT collected on the first invoice via the draft path.
    expect(stripe.invoices.update).toHaveBeenCalled(); // attempted, rejected
  });
});

describe("processEvent — first-invoice fee correction (BTS-68)", () => {
  /** A paid first invoice for a per_invoice destination-charge subscription. */
  const paidFirstInvoice = (overrides: Record<string, unknown> = {}) => ({
    id: "in_first",
    customer: "acct_buyer",
    currency: "usd",
    amount_due: 10000,
    amount_paid: 10000,
    status: "paid",
    application_fee_amount: null,
    metadata: {},
    parent: { subscription_details: { subscription: "sub_1" } },
    ...overrides,
  });

  /** Flag sub_1 as per_invoice with the given fee config. */
  function wireSub(
    stripe: ReturnType<typeof makeStripe>,
    config: unknown = { percent: 2.9, fixed: 30 },
  ) {
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsFeeMode: "per_invoice",
        bsFeeConfig: JSON.stringify(config),
      },
    });
  }

  /** Wire the fresh-invoice retrieve + charge → transfer resolution. */
  function wireInvoiceCharge(
    stripe: ReturnType<typeof makeStripe>,
    fresh: Record<string, unknown>,
  ) {
    stripe.invoices.retrieve.mockResolvedValue(fresh);
    stripe.invoicePayments.list.mockResolvedValue({
      data: [{ payment: { charge: "ch_first" } }],
    });
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_first",
      transfer: "tr_first",
    });
  }

  it("collects the first invoice's fixed/tier fee by reversing the destination transfer", async () => {
    const stripe = makeStripe();
    wireSub(stripe);
    wireInvoiceCharge(stripe, paidFirstInvoice());
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    // round(10000 * 0.029) + 30 = 320, clawed back from the auto-transfer.
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_first",
      { amount: 320, metadata: { bsFeeFor: "in_first" } },
      { idempotencyKey: "bs_infee_in_first" },
    );
    // Marked collected on the invoice (metadata is editable post-finalization).
    expect(stripe.invoices.update).toHaveBeenCalledWith(
      "in_first",
      expect.objectContaining({
        metadata: expect.objectContaining({
          bsFeeCollected: "1",
          bsFeeAmount: "320",
        }),
      }),
    );
  });

  it("collects a tiered first-invoice fee (matching tier's percent + fixed)", async () => {
    const stripe = makeStripe();
    wireSub(stripe, {
      percent: 10,
      tiers: [
        { upTo: 5000, percent: 5 },
        { upTo: null, percent: 8, fixed: 100 },
      ],
    });
    wireInvoiceCharge(stripe, paidFirstInvoice());
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    // amount 10000 → catch-all tier: round(10000 * 0.08) + 100 = 900
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_first",
      expect.objectContaining({ amount: 900 }),
      { idempotencyKey: "bs_infee_in_first" },
    );
  });

  it("does NOT reverse a renewal invoice that already carries application_fee_amount", async () => {
    const stripe = makeStripe();
    wireSub(stripe);
    // Draft-window path already set the fee on this (renewal) invoice.
    wireInvoiceCharge(
      stripe,
      paidFirstInvoice({ application_fee_amount: 320 }),
    );
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("does NOT reverse a renewal invoice already marked bsFeeApplied", async () => {
    const stripe = makeStripe();
    wireSub(stripe);
    wireInvoiceCharge(
      stripe,
      paidFirstInvoice({ metadata: { bsFeeApplied: "1" } }),
    );
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("does nothing for a subscription that is not flagged per_invoice (e.g. percent-only)", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {}, // percent-only fees ride application_fee_percent, not per_invoice
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("is idempotent — an invoice already marked bsFeeCollected is not reversed again", async () => {
    const stripe = makeStripe();
    wireSub(stripe);
    wireInvoiceCharge(
      stripe,
      paidFirstInvoice({
        metadata: { bsFeeCollected: "1", bsFeeAmount: "320" },
      }),
    );
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.invoices.update).not.toHaveBeenCalled();
  });

  it("skips a zero-amount invoice (100%-off / trial) before touching the subscription", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.paid", paidFirstInvoice({ amount_paid: 0 })),
    );

    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("does not send a non-finite fee from a shape-invalid config", async () => {
    const stripe = makeStripe();
    // No `percent` → computeFee returns NaN; must never reach a reversal.
    wireSub(stripe, { fixed: 30 });
    wireInvoiceCharge(stripe, paidFirstInvoice());
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("invoice.paid", paidFirstInvoice()));

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("logs and skips (no crash) when the charge has no destination transfer to reverse", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripe = makeStripe();
    wireSub(stripe);
    stripe.invoices.retrieve.mockResolvedValue(paidFirstInvoice());
    stripe.invoicePayments.list.mockResolvedValue({
      data: [{ payment: { charge: "ch_first" } }],
    });
    stripe.charges.retrieve.mockResolvedValue({ id: "ch_first" }); // no transfer
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(whCtx, event("invoice.paid", paidFirstInvoice())),
    ).resolves.toBeUndefined();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });

  it("propagates a reversal failure so the event is marked failed and Stripe retries", async () => {
    const stripe = makeStripe();
    wireSub(stripe);
    wireInvoiceCharge(stripe, paidFirstInvoice());
    stripe.transfers.createReversal.mockRejectedValue(new Error("stripe down"));
    const whCtx = makeWhCtx({ stripe });

    // A swallowed failure would 200 → event ledger "processed" (terminal) → the
    // first-invoice fee is lost forever. It must throw so Stripe retries.
    await expect(
      processEvent(whCtx, event("invoice.paid", paidFirstInvoice())),
    ).rejects.toThrow("stripe down");
  });
});

describe("processEvent — per-charge fixed/tier fee (BTS-60)", () => {
  /** A succeeded one-time destination-charge PI flagged for per-charge fee. */
  const flaggedPi = (overrides: Record<string, unknown> = {}) => ({
    id: "pi_fee",
    amount: 10000,
    currency: "usd",
    status: "succeeded",
    latest_charge: "ch_fee",
    transfer_data: { destination: "acct_seller" },
    metadata: {
      bsFeeMode: "per_charge",
      bsFeeConfig: JSON.stringify({ percent: 2.9, fixed: 30 }),
    },
    ...overrides,
  });

  /** Wire the retrieve mocks for the happy path: fresh PI + charge w/ transfer. */
  function wireHappyPath(
    stripe: ReturnType<typeof makeStripe>,
    pi: Record<string, unknown>,
    opts: { amountReceived?: number; freshMetadata?: Record<string, string> } = {},
  ) {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      ...pi,
      amount_received: opts.amountReceived ?? (pi.amount as number),
      ...(opts.freshMetadata ? { metadata: opts.freshMetadata } : {}),
    });
    stripe.charges.retrieve.mockResolvedValue({
      id: pi.latest_charge,
      transfer: "tr_auto",
    });
  }

  it("collects a fixed fee by partially reversing the destination transfer", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi();
    wireHappyPath(stripe, pi);
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("payment_intent.succeeded", pi));

    // round(10000 * 0.029) + 30 = 320, clawed back from the auto-transfer.
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_auto",
      expect.objectContaining({ amount: 320 }),
      { idempotencyKey: "bs_pcfee_pi_fee" },
    );
    // Marked collected on the PI so retries beyond Stripe's idempotency window skip.
    expect(stripe.paymentIntents.update).toHaveBeenCalledWith(
      "pi_fee",
      expect.objectContaining({
        metadata: expect.objectContaining({
          bsFeeCollected: "1",
          bsFeeAmount: "320",
        }),
      }),
    );
    // Denormalized onto the payments row.
    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/connect/mutations/upsertPayment");
    expect(data.feeCollectedAmount).toBe(320);
  });

  it("collects a tiered fee (matching tier's percent + fixed)", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi({
      metadata: {
        bsFeeMode: "per_charge",
        bsFeeConfig: JSON.stringify({
          percent: 10,
          tiers: [
            { upTo: 5000, percent: 5 },
            { upTo: null, percent: 8, fixed: 100 },
          ],
        }),
      },
    });
    wireHappyPath(stripe, pi);
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("payment_intent.succeeded", pi));

    // amount 10000 → catch-all tier: round(10000 * 0.08) + 100 = 900
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_auto",
      expect.objectContaining({ amount: 900 }),
      { idempotencyKey: "bs_pcfee_pi_fee" },
    );
  });

  it("computes the fee from the amount actually charged, not the list amount", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi();
    // A Checkout promotion code discounted the final charge to 8000.
    wireHappyPath(stripe, pi, { amountReceived: 8000 });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("payment_intent.succeeded", pi));

    // round(8000 * 0.029) + 30 = 262 — NOT 320 from the stale event amount.
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_auto",
      expect.objectContaining({ amount: 262 }),
      expect.anything(),
    );
  });

  it("is idempotent — a PI already marked bsFeeCollected is not reversed again", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi();
    // The fresh PI (not the stale event snapshot) carries the marker.
    wireHappyPath(stripe, pi, {
      freshMetadata: {
        bsFeeMode: "per_charge",
        bsFeeConfig: JSON.stringify({ percent: 2.9, fixed: 30 }),
        bsFeeCollected: "1",
        bsFeeAmount: "320",
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(whCtx, event("payment_intent.succeeded", pi));

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.update).not.toHaveBeenCalled();
    // The payments row still reflects the previously collected fee.
    expect(dispatchedPayload(whCtx.ctx).data.feeCollectedAmount).toBe(320);
  });

  it("does nothing for a PI without the per_charge marker", async () => {
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("payment_intent.succeeded", flaggedPi({ metadata: {} })),
    );

    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(dispatchedPayload(whCtx.ctx).data.feeCollectedAmount).toBeUndefined();
  });

  it("swallows malformed bsFeeConfig without reversing or crashing", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi({
      metadata: { bsFeeMode: "per_charge", bsFeeConfig: "not json" },
    });
    wireHappyPath(stripe, pi);
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(whCtx, event("payment_intent.succeeded", pi)),
    ).resolves.toBeUndefined();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("propagates a reversal failure so the event is marked failed and Stripe retries", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi();
    wireHappyPath(stripe, pi);
    stripe.transfers.createReversal.mockRejectedValue(new Error("stripe down"));
    const whCtx = makeWhCtx({ stripe });

    // A swallowed failure would 200 → event ledger "processed" (terminal) →
    // the fee is silently lost forever. Throwing marks the event "failed",
    // Stripe retries, and the whole case re-runs idempotently.
    await expect(
      processEvent(whCtx, event("payment_intent.succeeded", pi)),
    ).rejects.toThrow("stripe down");

    // The PI was never marked collected, so the retry collects the fee.
    expect(stripe.paymentIntents.update).not.toHaveBeenCalled();
    // Collection runs before the payment upsert, so nothing landed this
    // delivery — the retry writes the row (with the fee) in one pass instead
    // of leaving a partial row a second write would have to patch.
    expect(whCtx.ctx.runMutation).not.toHaveBeenCalled();
  });

  it("rethrows a mark failure after a successful reversal; the replay converges on the same idempotency key", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi();
    wireHappyPath(stripe, pi);
    stripe.paymentIntents.update.mockRejectedValueOnce(new Error("mark failed"));
    const whCtx = makeWhCtx({ stripe });

    // Delivery 1: reversal succeeds, marking the PI fails → must throw (the
    // event goes "failed" and retries) rather than end "processed" with an
    // unmarked PI and no feeCollectedAmount on the payments row.
    await expect(
      processEvent(whCtx, event("payment_intent.succeeded", pi)),
    ).rejects.toThrow("mark failed");

    // Delivery 2 (Stripe retry): the fresh PI is still unmarked, so the
    // reversal is re-sent — with the IDENTICAL idempotency key and params
    // (inputs are immutable post-success), so Stripe replays it without a
    // second money movement. Then the mark and the payment upsert land.
    await processEvent(whCtx, event("payment_intent.succeeded", pi));

    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = stripe.transfers.createReversal.mock
      .calls as unknown as [unknown, unknown, unknown][];
    expect(secondCall).toEqual(firstCall);
    expect(firstCall[2]).toEqual({ idempotencyKey: "bs_pcfee_pi_fee" });
    expect(stripe.paymentIntents.update).toHaveBeenCalledTimes(2);
    const { path, data } = dispatchedPayload(whCtx.ctx);
    expect(path).toBe("betterStripe/connect/mutations/upsertPayment");
    expect(data.feeCollectedAmount).toBe(320);
  });

  it("skips (without throwing) when the charge has no destination transfer", async () => {
    const stripe = makeStripe();
    const pi = flaggedPi();
    wireHappyPath(stripe, pi);
    // Anomalous config a retry can't fix — rethrowing would loop the event
    // "failed" forever. Logged skip instead.
    stripe.charges.retrieve.mockResolvedValue({ id: "ch_fee", transfer: null });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(whCtx, event("payment_intent.succeeded", pi)),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    // The payment row still lands (without a fee) — the sale itself is real.
    expect(dispatchedPayload(whCtx.ctx).path).toBe(
      "betterStripe/connect/mutations/upsertPayment",
    );
  });

  it("[regression] the per_invoice path is untouched by the per-charge consumer", async () => {
    const stripe = makeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      metadata: {
        bsFeeMode: "per_invoice",
        bsFeeConfig: JSON.stringify({ percent: 2.9, fixed: 30 }),
      },
    });
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.created", {
        id: "in_fee",
        currency: "usd",
        amount_due: 10000,
        amount_paid: 0,
        status: "draft",
        metadata: {},
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    );

    // Still applied as an application_fee_amount on the draft invoice…
    expect(stripe.invoices.update).toHaveBeenCalledWith("in_fee", {
      application_fee_amount: 320,
      metadata: { bsFeeApplied: "1" },
    });
    // …and never via the per-charge reversal machinery.
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});

describe("processEvent — refunds: split clawback + fee-refund denormalization (BTS-34)", () => {
  /** Two split-engine ledger legs for ch_1 (original amounts, minor units). */
  const ledgerLegs = (
    overrides: { reversedStore?: number; reversedAff?: number } = {},
  ) => [
    {
      stripeTransferId: "tr_s",
      amount: 7000,
      destinationAccountId: "acct_store",
      role: "store",
      currency: "usd",
      ...(overrides.reversedStore !== undefined
        ? { reversedAmount: overrides.reversedStore }
        : {}),
    },
    {
      stripeTransferId: "tr_a",
      amount: 1000,
      destinationAccountId: "acct_aff",
      role: "affiliate",
      currency: "usd",
      ...(overrides.reversedAff !== undefined
        ? { reversedAmount: overrides.reversedAff }
        : {}),
    },
  ];

  const refundEvent = (overrides: Record<string, unknown> = {}) =>
    event("refund.created", {
      id: "re_1",
      charge: "ch_1",
      payment_intent: "pi_1",
      amount: 5000,
      currency: "usd",
      status: "succeeded",
      metadata: {},
      ...overrides,
    });

  it("reverses split-sale transfers pro-rata on a succeeded partial refund", async () => {
    const ctx = makeCtx({ query: ledgerLegs() });
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      amount: 10000,
      amount_refunded: 5000,
    });
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, refundEvent());

    // 50% refunded → each leg reversed to 50% of its original amount.
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_s",
      { amount: 3500 },
      { idempotencyKey: "bs_rev_re_1_tr_s" },
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_a",
      { amount: 500 },
      { idempotencyKey: "bs_rev_re_1_tr_a" },
    );
  });

  it("reverses the full transfer amounts on a full refund", async () => {
    const ctx = makeCtx({ query: ledgerLegs() });
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      amount: 10000,
      amount_refunded: 10000,
    });
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, refundEvent({ amount: 10000 }));

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_s",
      { amount: 7000 },
      { idempotencyKey: "bs_rev_re_1_tr_s" },
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_a",
      { amount: 1000 },
      { idempotencyKey: "bs_rev_re_1_tr_a" },
    );
  });

  it("a second partial refund reverses only the delta up to the new cumulative target", async () => {
    // First refund (5000) already clawed back 3500/500 and was recorded.
    const ctx = makeCtx({
      query: ledgerLegs({ reversedStore: 3500, reversedAff: 500 }),
    });
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      amount: 10000,
      amount_refunded: 7000, // cumulative: 5000 + this refund's 2000
    });
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, refundEvent({ id: "re_2", amount: 2000 }));

    // Target 70% of each leg minus what's already reversed: 4900-3500, 700-500.
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_s",
      { amount: 1400 },
      { idempotencyKey: "bs_rev_re_2_tr_s" },
    );
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_a",
      { amount: 200 },
      { idempotencyKey: "bs_rev_re_2_tr_a" },
    );
  });

  it("is idempotent — a redelivered refund event whose reversals are recorded reverses nothing", async () => {
    const ctx = makeCtx({
      query: ledgerLegs({ reversedStore: 3500, reversedAff: 500 }),
    });
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      amount: 10000,
      amount_refunded: 5000,
    });
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, refundEvent());

    // Cumulative target (50%) already met on both legs — no delta, no calls.
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("skips clawback quietly for a refund on a non-split sale", async () => {
    const ctx = makeCtx({ query: [] });
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, refundEvent());

    // No ledger legs → not a split sale (Stripe-native reverse_transfer covers
    // destination charges). No charge lookup, no reversals, no throw.
    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("does not claw back for a pending refund", async () => {
    const ctx = makeCtx({ query: ledgerLegs() });
    const stripe = makeStripe();
    const whCtx = makeWhCtx({ ctx, stripe });

    await processEvent(whCtx, refundEvent({ status: "pending" }));

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("propagates a reversal failure so the event is marked failed and Stripe retries", async () => {
    const ctx = makeCtx({ query: ledgerLegs() });
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      amount: 10000,
      amount_refunded: 5000,
    });
    stripe.transfers.createReversal.mockRejectedValue(new Error("stripe down"));
    const whCtx = makeWhCtx({ ctx, stripe });

    await expect(processEvent(whCtx, refundEvent())).rejects.toThrow(
      "stripe down",
    );
  });

  it("application_fee.refunded sets absolute fee totals on the linked payment", async () => {
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({
      id: "ch_1",
      payment_intent: "pi_1",
    });
    const whCtx = makeWhCtx({ stripe });

    const feeEvent = event("application_fee.refunded", {
      id: "fee_1",
      charge: "ch_1",
      amount: 320,
      amount_refunded: 160,
      currency: "usd",
    });
    await processEvent(whCtx, feeEvent);

    const calls = whCtx.ctx.runMutation.mock.calls;
    const feeCall = calls.find(
      (c) =>
        c[0][TO_REF] === "betterStripe/connect/mutations/recordPaymentFeeRefund",
    );
    expect(feeCall).toBeDefined();
    // Absolute cumulative values straight from Stripe — never incremented, so
    // a redelivery (or a createRefund-triggered duplicate) can't double-count.
    expect(feeCall![1]).toEqual({
      stripePaymentIntentId: "pi_1",
      feeCollectedAmount: 160,
      feeRefundedAmount: 160,
    });

    // Redelivery writes the identical absolute state.
    await processEvent(whCtx, feeEvent);
    const feeCalls = whCtx.ctx.runMutation.mock.calls.filter(
      (c) =>
        c[0][TO_REF] === "betterStripe/connect/mutations/recordPaymentFeeRefund",
    );
    expect(feeCalls).toHaveLength(2);
    expect(feeCalls[1][1]).toEqual(feeCalls[0][1]);
  });

  it("application_fee.refunded skips quietly when the charge has no payment intent", async () => {
    const stripe = makeStripe();
    stripe.charges.retrieve.mockResolvedValue({ id: "ch_1", payment_intent: null });
    const whCtx = makeWhCtx({ stripe });

    await expect(
      processEvent(
        whCtx,
        event("application_fee.refunded", {
          id: "fee_1",
          charge: "ch_1",
          amount: 320,
          amount_refunded: 320,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(whCtx.ctx.runMutation).not.toHaveBeenCalled();
  });
});
