import { afterEach, expect, it, vi } from "vitest";

import { getStripeClient } from "../helpers.js";
import { BetterStripe } from "../index.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const key = `sk_test_exact_invoice_payment_${crypto.randomUUID()}`;
  const stripe = getStripeClient(key);
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const ctx = { runQuery: vi.fn() };
  const scope = {
    stripeInvoiceId: "in_original",
    customerAccount: "acct_original",
    stripeSubscriptionId: "sub_original",
  };
  const invoice = {
    id: scope.stripeInvoiceId,
    customer_account: scope.customerAccount,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: scope.stripeSubscriptionId },
    },
  };
  const payment = {
    id: "inpay_original",
    object: "invoice_payment",
    invoice: scope.stripeInvoiceId,
    amount_paid: 0,
    amount_requested: 1200,
    currency: "jpy",
    status: "open",
    payment: { type: "payment_intent", payment_intent: "pi_original" },
  };
  const invoiceRead = vi
    .spyOn(stripe.invoices, "retrieve")
    .mockResolvedValue(invoice as never);
  const list = vi.spyOn(stripe.invoicePayments, "list").mockResolvedValue({
    data: [payment],
    has_more: false,
  } as never);
  const retrieve = vi
    .spyOn(stripe.invoicePayments, "retrieve")
    .mockResolvedValue(payment as never);
  return { client, ctx, scope, invoice, invoiceRead, payment, list, retrieve };
}

it("retains the real public page reader and exact original zero units as a positive control", async () => {
  const f = fixture();
  const result = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.scope);
  expect(result.page).toEqual([
    {
      invoicePayment: f.payment,
      paymentIntentId: "pi_original",
      referenceStatus: "payment_intent",
    },
  ]);
  expect(f.list).toHaveBeenCalledOnce();
  expect(f.retrieve).not.toHaveBeenCalled();
});

it("reads the exact original payment with zero paid units without enumerating", async () => {
  const f = fixture();
  const result = await f.client.getInvoicePaymentFromStripe(f.ctx, {
    ...f.scope,
    stripeInvoicePaymentId: f.payment.id,
  });
  expect(result).toEqual({
    scope: f.scope,
    invoicePayment: f.payment,
    paymentIntentId: "pi_original",
    referenceStatus: "payment_intent",
  });
  expect(f.retrieve).toHaveBeenCalledExactlyOnceWith("inpay_original");
  expect(f.invoiceRead).toHaveBeenCalledExactlyOnceWith("in_original");
  expect(f.list).not.toHaveBeenCalled();
});

it.each([
  { stripeInvoicePaymentId: "bad" },
  { stripeInvoiceId: "bad" },
  { customerAccount: "cus_wrong" },
  { stripeSubscriptionId: "bad" },
  { connectedAccountId: "acct_other" },
])(
  "rejects invalid/unsupported selectors before provider access %#",
  async (change) => {
    const f = fixture();
    await expect(
      f.client.getInvoicePaymentFromStripe(f.ctx, {
        ...f.scope,
        stripeInvoicePaymentId: f.payment.id,
        ...change,
      }),
    ).rejects.toThrow();
    expect(f.invoiceRead).not.toHaveBeenCalled();
    expect(f.retrieve).not.toHaveBeenCalled();
  },
);

it.each([
  { id: "in_other" },
  { customer_account: "acct_other" },
  { parent: null },
  {
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_other" },
    },
  },
])("holds foreign or missing original invoice binding %#", async (change) => {
  const f = fixture();
  f.invoiceRead.mockResolvedValue({ ...f.invoice, ...change } as never);
  await expect(
    f.client.getInvoicePaymentFromStripe(f.ctx, {
      ...f.scope,
      stripeInvoicePaymentId: f.payment.id,
    }),
  ).rejects.toThrow();
  expect(f.retrieve).not.toHaveBeenCalled();
});

it.each([
  null,
  { id: "inpay_other" },
  { invoice: "in_other" },
  { object: "payment_intent" },
  { payment: null },
  { amount_requested: Number.MAX_SAFE_INTEGER + 1 },
  { amount_paid: -1 },
  { amount_paid: 1.5 },
  { currency: "invalid" },
])(
  "rejects missing, mismatched or malformed exact provider evidence %#",
  async (change) => {
    const f = fixture();
    f.retrieve.mockResolvedValue(
      change === null
        ? (null as never)
        : ({ ...f.payment, ...change } as never),
    );
    await expect(
      f.client.getInvoicePaymentFromStripe(f.ctx, {
        ...f.scope,
        stripeInvoicePaymentId: f.payment.id,
      }),
    ).rejects.toThrow();
    expect(f.list).not.toHaveBeenCalled();
  },
);

it.each([
  {
    type: "payment_intent",
    payment_intent: { id: "pi_expanded" },
    expected: "payment_intent",
    id: "pi_expanded",
  },
  {
    type: "payment_intent",
    payment_intent: null,
    expected: "unavailable",
    id: null,
  },
  {
    type: "payment_intent",
    payment_intent: "malformed",
    expected: "unavailable",
    id: null,
  },
  { type: "charge", charge: "ch_original", expected: "unsupported", id: null },
  { type: "future_reference", expected: "unsupported", id: null },
])(
  "preserves original exact row and honest reference distinction %#",
  async ({ expected, id, ...payment }) => {
    const f = fixture();
    const row = {
      ...f.payment,
      invoice: { id: f.scope.stripeInvoiceId },
      amount_paid: null,
      status: "canceled",
      payment,
    };
    f.retrieve.mockResolvedValue(row as never);
    const result = await f.client.getInvoicePaymentFromStripe(f.ctx, {
      ...f.scope,
      stripeInvoicePaymentId: f.payment.id,
    });
    expect(result.invoicePayment).toEqual(row);
    expect(result.referenceStatus).toBe(expected);
    expect(result.paymentIntentId).toBe(id);
  },
);

it.each(["invoice", "payment"])(
  "propagates %s provider outage without empty fallback",
  async (source) => {
    const f = fixture();
    const error = new Error("synthetic provider unavailable");
    (source === "invoice" ? f.invoiceRead : f.retrieve).mockRejectedValue(
      error,
    );
    await expect(
      f.client.getInvoicePaymentFromStripe(f.ctx, {
        ...f.scope,
        stripeInvoicePaymentId: f.payment.id,
      }),
    ).rejects.toBe(error);
    expect(f.list).not.toHaveBeenCalled();
  },
);

it("freezes primitive original selectors before awaiting the invoice provider response", async () => {
  const f = fixture();
  const options = { ...f.scope, stripeInvoicePaymentId: f.payment.id };
  let release = () => {};
  f.invoiceRead.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return f.invoice as never;
  });
  const pending = f.client.getInvoicePaymentFromStripe(f.ctx, options);
  options.stripeInvoiceId = "in_replaced";
  options.stripeInvoicePaymentId = "inpay_replaced";
  options.customerAccount = "acct_replaced";
  options.stripeSubscriptionId = "sub_replaced";
  release();
  const result = await pending;
  expect(f.retrieve).toHaveBeenCalledExactlyOnceWith("inpay_original");
  expect(result.scope).toEqual(f.scope);
});
