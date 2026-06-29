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
    paymentIntents: { retrieve: vi.fn() },
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
    const whCtx = makeWhCtx({ stripe });

    await processEvent(
      whCtx,
      event("invoice.created", flaggedInvoice({ metadata: { bsFeeApplied: "1" } })),
    );
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
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
});
