import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

function fixture() {
  const key = `sk_test_source_${crypto.randomUUID()}`;
  const apiVersion = "2026-09-30.preview";
  const client = new BetterStripe(
    componentsGeneric().betterStripe as unknown as Component,
    {
      STRIPE_SECRET_KEY: key,
      stripeApiVersion: apiVersion,
    },
  );
  const transaction = {
    id: "txn_source",
    object: "balance_transaction",
    source: "ch_source",
    amount: 1000,
    fee: 50,
    net: 950,
    currency: "usd",
  };
  const payment = {
    id: "pi_source",
    object: "payment_intent",
    status: "succeeded",
    amount: 1000,
    amount_received: 1000,
    currency: "usd",
    customer_account: "acct_customer",
    livemode: false,
    metadata: { stripePriceId: "price_untrusted" },
    latest_charge: {
      id: "ch_source",
      object: "charge",
      payment_intent: "pi_source",
      amount: 1000,
      amount_captured: 1000,
      currency: "usd",
      paid: true,
      captured: true,
      status: "succeeded",
      amount_refunded: 0,
      disputed: false,
      livemode: false,
      balance_transaction: transaction,
    },
  };
  const invoice = {
    id: "in_source",
    object: "invoice",
    status: "paid",
    currency: "usd",
    amount_paid: 1000,
    amount_due: 1000,
    amount_remaining: 0,
    total: 1000,
    amount_overpaid: 0,
    starting_balance: 0,
    ending_balance: 0,
    customer_account: "acct_customer",
    livemode: false,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_source" },
    },
  };
  const funding = {
    id: "inpay_source",
    object: "invoice_payment",
    invoice: "in_source",
    status: "paid",
    currency: "usd",
    amount_paid: 1000,
    amount_requested: 1000,
    livemode: false,
    payment: { type: "payment_intent", payment_intent: "pi_source" },
  };
  const line = {
    id: "il_source",
    object: "line_item",
    invoice: "in_source",
    currency: "usd",
    amount: 1000,
    quantity: 1,
    livemode: false,
    parent: {
      type: "subscription_item_details",
      subscription_item_details: {
        subscription: "sub_source",
        subscription_item: "si_source",
        proration: false,
      },
    },
    pricing: {
      type: "price_details",
      price_details: { price: "price_original", product: "prod_original" },
      unit_amount_decimal: "1000",
    },
  };
  const subscription = {
    id: "sub_source",
    object: "subscription",
    customer_account: "acct_customer",
    livemode: false,
    metadata: { sellerId: "untrusted" },
    items: {
      data: [{ price: { id: "price_current", product: "prod_current" } }],
    },
  };
  const history = { inverse: [funding], funding: [funding], lines: [line] };
  const pages = new Map<string, { data: unknown[]; has_more: boolean }>();
  const requests: {
    path: string;
    method: string;
    version: string;
    account: string;
  }[] = [];
  const sdk = getStripeClient(key, apiVersion);
  (
    sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
  )._setApiField("httpClient", {
    getClientName: () => "verified-source-contract",
    makeRequest: async (
      ...[, , path, method, headers]: Parameters<
        ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
      >
    ) => {
      requests.push({
        path,
        method,
        version: String(headers["Stripe-Version"]),
        account: String(headers["Stripe-Account"]),
      });
      const url = new URL(path, "https://stripe.test");
      const phase = url.pathname.endsWith("/lines")
        ? "lines"
        : url.searchParams.has("invoice")
          ? "funding"
          : "inverse";
      const override = pages.get(
        phase + ":" + (url.searchParams.get("starting_after") ?? ""),
      );
      const data =
        url.pathname === "/v1/payment_intents/pi_source"
          ? payment
          : url.pathname === "/v1/invoices/in_source"
            ? invoice
            : url.pathname === "/v1/subscriptions/sub_source"
              ? subscription
              : {
                  object: "list",
                  url: url.pathname,
                  has_more: override?.has_more ?? false,
                  data:
                    override?.data ??
                    (phase === "lines"
                      ? history.lines
                      : phase === "funding"
                        ? history.funding
                        : history.inverse),
                };
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () => data,
        toStream: () => {
          throw new Error("Unexpected stream");
        },
      };
    },
  });
  const options = {
    paymentIntentId: "pi_source",
    customerAccountId: "acct_customer",
    stripeAccountId: "acct_connected",
    gross: 1000,
    currency: "usd",
  };
  const resolve = (
    overrides: Partial<typeof options> & {
      maxHistoryPages?: number;
      maxHistoryItems?: number;
    } = {},
  ) => {
    return client.getVerifiedPaymentSource({} as RunCtx, {
      ...options,
      ...overrides,
    });
  };
  return {
    resolve,
    client,
    options,
    payment,
    invoice,
    funding,
    line,
    subscription,
    history,
    requests,
    pages,
  };
}

it("resolves a complete original invoice price through the inherited SDK method, ignoring current prices and metadata", async () => {
  const s = fixture();
  expect(await s.resolve()).toEqual({
    status: "ready",
    value: {
      paymentIntentId: "pi_source",
      chargeId: "ch_source",
      invoiceId: "in_source",
      invoicePaymentId: "inpay_source",
      subscriptionId: "sub_source",
      customerAccountId: "acct_customer",
      stripeAccountId: "acct_connected",
      stripePriceId: "price_original",
      stripeProductId: "prod_original",
      gross: 1000,
      processingFee: 50,
      currency: "usd",
      livemode: false,
    },
  });
  expect(s.requests).toHaveLength(6);
  expect(
    s.requests.every(
      (r) =>
        r.method === "GET" &&
        r.version === "2026-09-30.preview" &&
        r.account === "acct_connected",
    ),
  ).toBe(true);
});

type Fixture = ReturnType<typeof fixture>;
const terminal = (reason: string) => ({
  status: "rejected",
  reason,
  retryable: false,
});
const conflict = {
  status: "conflict",
  reason: "identity_changed",
  retryable: false,
};
const incomplete = {
  status: "unknown",
  reason: "history_incomplete",
  retryable: false,
};
it.each([
  [
    "foreign payment",
    (s: Fixture): unknown => (s.payment.id = "pi_foreign"),
    conflict,
  ],
  [
    "foreign charge",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.payment_intent = "pi_foreign"),
    conflict,
  ],
  [
    "foreign invoice",
    (s: Fixture): unknown => (s.invoice.id = "in_foreign"),
    conflict,
  ],
  [
    "foreign customer",
    (s: Fixture): unknown => (s.invoice.customer_account = "acct_foreign"),
    conflict,
  ],
  [
    "foreign subscription",
    (s: Fixture): unknown => (s.subscription.id = "sub_foreign"),
    conflict,
  ],
  [
    "foreign invoice line",
    (s: Fixture): unknown => (s.line.invoice = "in_foreign"),
    conflict,
  ],
  [
    "foreign funding row",
    (s: Fixture): unknown => (s.funding.invoice = "in_foreign"),
    conflict,
  ],
  [
    "foreign balance transaction",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.balance_transaction.source = "ch_foreign"),
    conflict,
  ],
  [
    "invoice currency",
    (s: Fixture): unknown => (s.invoice.currency = "eur"),
    terminal("currency_mismatch"),
  ],
  [
    "funding currency",
    (s: Fixture): unknown => (s.funding.currency = "eur"),
    terminal("currency_mismatch"),
  ],
  [
    "line currency",
    (s: Fixture): unknown => (s.line.currency = "eur"),
    terminal("currency_mismatch"),
  ],
  [
    "balance currency",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.balance_transaction.currency = "eur"),
    terminal("currency_mismatch"),
  ],
  [
    "partial payment",
    (s: Fixture): unknown => (s.funding.amount_paid = 900),
    terminal("unsupported_source"),
  ],
  [
    "credit-funded invoice",
    (s: Fixture): unknown => (s.invoice.total = 1100),
    terminal("unsupported_source"),
  ],
  [
    "unsafe amount",
    (s: Fixture): unknown =>
      (s.payment.amount_received = Number.MAX_SAFE_INTEGER + 1),
    terminal("unsupported_source"),
  ],
  [
    "negative fee",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.balance_transaction.fee = -1),
    terminal("unsupported_source"),
  ],
  [
    "unreconciled transaction",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.balance_transaction.net = 999),
    terminal("unsupported_source"),
  ],
  [
    "missing original price",
    (s: Fixture): void => {
      Object.assign(s.line, { pricing: null });
    },
    terminal("unsupported_source"),
  ],
  [
    "multiple invoice lines",
    (s: Fixture): void => {
      s.history.lines.push({ ...s.line, id: "il_second" });
    },
    terminal("unsupported_source"),
  ],
  [
    "multiple paid allocations",
    (s: Fixture): void => {
      s.history.funding.push({ ...s.funding, id: "inpay_second" });
    },
    terminal("unsupported_source"),
  ],
] as const)(
  "refuses %s without guessing source economics",
  async (_name, mutate, expected) => {
    const s = fixture();
    mutate(s);
    expect(await s.resolve()).toEqual(expected);
  },
);

it("preserves refunded/disputed original funding as cost provenance", async () => {
  const s = fixture();
  s.payment.latest_charge.amount_refunded = 1000;
  s.payment.latest_charge.disputed = true;
  expect(await s.resolve()).toMatchObject({
    status: "ready",
    value: { gross: 1000, processingFee: 50, stripePriceId: "price_original" },
  });
});
it("keeps missing fees explicit while accepting provider-verified zero fees", async () => {
  const missing = fixture();
  Object.assign(missing.payment.latest_charge, { balance_transaction: null });
  expect(await missing.resolve()).toEqual({
    status: "not_ready",
    reason: "fee_pending",
    retryable: true,
  });
  const zero = fixture();
  zero.payment.latest_charge.balance_transaction.fee = 0;
  zero.payment.latest_charge.balance_transaction.net = 1000;
  expect(await zero.resolve()).toMatchObject({
    status: "ready",
    value: { processingFee: 0 },
  });
});
it.each([0, -1, 1.5, Infinity, 21])(
  "rejects invalid history page cap %s before provider reads",
  async (maxHistoryPages) => {
    const s = fixture();
    expect(await s.resolve({ maxHistoryPages })).toEqual(
      terminal("invalid_scope"),
    );
    expect(s.requests).toHaveLength(0);
  },
);
it.each(["inverse", "funding", "lines"])(
  "holds incomplete %s history at the hard cap",
  async (phase) => {
    const s = fixture();
    s.pages.set(phase + ":", {
      data: [phase === "lines" ? s.line : s.funding],
      has_more: true,
    });
    expect(await s.resolve({ maxHistoryPages: 1 })).toEqual(incomplete);
  },
);
it("rejects duplicate history across pages rather than claiming unique funding", async () => {
  const s = fixture();
  s.pages.set("inverse:", { data: [s.funding], has_more: true });
  s.pages.set("inverse:inpay_source", { data: [s.funding], has_more: false });
  expect(await s.resolve()).toEqual(incomplete);
});
it("holds oversized and non-progressing provider envelopes", async () => {
  const large = fixture();
  large.pages.set("inverse:", {
    data: Array.from({ length: 101 }, (_, i) => ({
      ...large.funding,
      id: "inpay_" + i,
    })),
    has_more: false,
  });
  expect(await large.resolve()).toEqual(incomplete);
  const empty = fixture();
  empty.pages.set("inverse:", { data: [], has_more: true });
  expect(await empty.resolve()).toEqual(incomplete);
});

it.each([
  [
    "charge ID",
    (s: Fixture): void => {
      s.payment.latest_charge.id = "";
      s.payment.latest_charge.balance_transaction.source = "";
    },
  ],
  [
    "balance ID",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.balance_transaction.id = ""),
  ],
  ["payment object", (s: Fixture): unknown => (s.payment.object = "customer")],
  [
    "charge object",
    (s: Fixture): unknown => (s.payment.latest_charge.object = "customer"),
  ],
  [
    "balance object",
    (s: Fixture): unknown =>
      (s.payment.latest_charge.balance_transaction.object = "customer"),
  ],
  ["invoice object", (s: Fixture): unknown => (s.invoice.object = "customer")],
  [
    "subscription object",
    (s: Fixture): unknown => (s.subscription.object = "customer"),
  ],
  ["line object", (s: Fixture): unknown => (s.line.object = "customer")],
] as const)("refuses malformed %s identity", async (_name, mutate) => {
  const s = fixture();
  mutate(s);
  expect(await s.resolve()).toEqual(conflict);
});

it("resolves original expanded price identifiers without consulting its current amount", async () => {
  const s = fixture();
  Object.assign(s.line.pricing.price_details, {
    price: { id: "price_original", object: "price", unit_amount: 9999 },
  });
  expect(await s.resolve()).toMatchObject({
    status: "ready",
    value: { stripePriceId: "price_original", gross: 1000 },
  });
});

it("finishes all funding pages before choosing a unique paid allocation", async () => {
  const s = fixture();
  const open = {
    ...s.funding,
    id: "inpay_open",
    status: "open",
    amount_paid: 0,
  };
  for (const phase of ["inverse", "funding"]) {
    s.pages.set(phase + ":", { data: [open], has_more: true });
    s.pages.set(phase + ":inpay_open", { data: [s.funding], has_more: false });
  }
  expect(
    await s.resolve({ maxHistoryPages: 2, maxHistoryItems: 2 }),
  ).toMatchObject({ status: "ready" });
  const paginated = s.requests.filter((r) =>
    r.path.includes("starting_after="),
  );
  expect(paginated).toHaveLength(2);
  expect(
    paginated.every((r) => r.path.includes("starting_after=inpay_open")),
  ).toBe(true);
  expect(s.requests.every((r) => !r.path.includes("status="))).toBe(true);
});

it.each(["inverse", "funding", "lines"])(
  "holds %s history at the item limit",
  async (phase) => {
    const s = fixture();
    s.pages.set(phase + ":", {
      data: [phase === "lines" ? s.line : s.funding],
      has_more: true,
    });
    expect(await s.resolve({ maxHistoryItems: 1 })).toEqual(incomplete);
  },
);

it.each([0, -1, 1.5, Infinity, 2001])(
  "rejects invalid item limit %s before reads",
  async (maxHistoryItems) => {
    const s = fixture();
    expect(await s.resolve({ maxHistoryItems })).toEqual(
      terminal("invalid_scope"),
    );
    expect(s.requests).toHaveLength(0);
  },
);

it("distinguishes pending from non-payable payment state", async () => {
  const pending = fixture();
  pending.payment.status = "processing";
  expect(await pending.resolve()).toEqual({
    status: "not_ready",
    reason: "provider_pending",
    retryable: true,
  });
  const canceled = fixture();
  canceled.payment.status = "canceled";
  expect(await canceled.resolve()).toEqual(terminal("payment_not_payable"));
});

it("requires every supplied expected binding to match provider evidence", async () => {
  for (const overrides of [
    { customerAccountId: "acct_foreign" },
    { invoiceId: "in_foreign" },
    { subscriptionId: "sub_foreign" },
  ]) {
    const s = fixture();
    expect(
      await s.client.getVerifiedPaymentSource({} as RunCtx, {
        ...s.options,
        ...overrides,
      }),
    ).toEqual(conflict);
  }
});

it("rejects malformed expanded original price IDs", async () => {
  const s = fixture();
  Object.assign(s.line.pricing.price_details, { price: { id: 123 } });
  expect(await s.resolve()).toEqual(terminal("unsupported_source"));
});

it("requires original line subscription binding and refuses proration", async () => {
  const mismatch = fixture();
  mismatch.line.parent.subscription_item_details.subscription = "sub_foreign";
  expect(await mismatch.resolve()).toEqual(conflict);
  const prorated = fixture();
  prorated.line.parent.subscription_item_details.proration = true;
  expect(await prorated.resolve()).toEqual(terminal("unsupported_source"));
});
