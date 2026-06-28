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

function makeStripe() {
  return { products: { retrieve: vi.fn() } };
}

function makeWhCtx(overrides?: {
  ctx?: ReturnType<typeof makeCtx>;
  stripe?: ReturnType<typeof makeStripe>;
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

  // Note: the platform fee lives on the charge/PaymentIntent, not the typed
  // Stripe.Invoice, so fee denormalization is captured on the `payments` row
  // (above) rather than the invoice.
});
