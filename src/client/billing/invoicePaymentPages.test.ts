import { afterEach, expect, it, vi } from "vitest";

import { getStripeClient } from "../helpers.js";
import { BetterStripe } from "../index.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const key = `sk_test_invoice_payments_${crypto.randomUUID()}`;
  const stripe = getStripeClient(key);
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const ctx = { runQuery: vi.fn() };
  const invoice = {
    id: "in_buyer",
    customer_account: "acct_buyer",
    currency: "jpy",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_buyer" },
    },
    payments: { data: [{ id: "inpay_truncated" }], has_more: true },
  };
  const retrieve = vi
    .spyOn(stripe.invoices, "retrieve")
    .mockResolvedValue(invoice as never);
  const list = vi.spyOn(stripe.invoicePayments, "list");
  const payment = (
    id = "inpay_first",
    type = "payment_intent",
    reference: string | null = "pi_paid",
  ) => ({
    id,
    object: "invoice_payment",
    invoice: "in_buyer",
    amount_paid: 1234,
    amount_requested: 1234,
    currency: "jpy",
    status: "paid",
    payment: { type, ...(reference ? { [type]: reference } : {}) },
  });
  const opts = {
    stripeInvoiceId: "in_buyer",
    customerAccount: "acct_buyer",
    stripeSubscriptionId: "sub_buyer",
  };
  return { stripe, client, ctx, invoice, retrieve, list, payment, opts };
}
it("verifies invoice scope before enumerating canonical payment references, ignoring truncated previews", async () => {
  const f = fixture();
  const row = f.payment();
  f.list.mockResolvedValue({ data: [row], has_more: false } as never);
  const result = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  expect(f.retrieve).toHaveBeenCalledExactlyOnceWith("in_buyer");
  expect(f.list).toHaveBeenCalledExactlyOnceWith({
    invoice: "in_buyer",
    limit: 25,
  });
  expect(result).toEqual({
    scope: f.opts,
    page: [
      {
        invoicePayment: row,
        paymentIntentId: "pi_paid",
        referenceStatus: "payment_intent",
      },
    ],
    hasMore: false,
    continueCursor: null,
  });
});
it("resumes all invoice payments and preserves unsupported and unavailable references", async () => {
  const f = fixture();
  f.list
    .mockResolvedValueOnce({ data: [f.payment()], has_more: true } as never)
    .mockResolvedValueOnce({
      data: [
        f.payment("inpay_charge", "charge", "ch_old"),
        f.payment("inpay_missing", "payment_intent", null),
      ],
      has_more: false,
    } as never);
  const first = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  const second = await f.client.getInvoicePaymentPageFromStripe(f.ctx, {
    ...f.opts,
    cursor: first.continueCursor,
  });
  expect(f.retrieve).toHaveBeenCalledTimes(2);
  expect(f.list).toHaveBeenLastCalledWith({
    invoice: "in_buyer",
    limit: 25,
    starting_after: "inpay_first",
  });
  expect(second.page.map((row) => row.referenceStatus)).toEqual([
    "unsupported",
    "unavailable",
  ]);
  expect(second.page.map((row) => row.paymentIntentId)).toEqual([null, null]);
});
it.each([
  { id: "in_foreign" },
  { customer_account: "acct_foreign" },
  {
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_foreign" },
    },
  },
  { parent: null },
])(
  "rejects foreign or missing invoice bindings before payment enumeration %#",
  async (change) => {
    const f = fixture();
    f.retrieve.mockResolvedValue({ ...f.invoice, ...change } as never);
    await expect(
      f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts),
    ).rejects.toThrow();
    expect(f.list).not.toHaveBeenCalled();
  },
);
it.each([
  { stripeInvoiceId: "bad" },
  { customerAccount: "cus_wrong" },
  { stripeSubscriptionId: "bad" },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { cursor: "invalid" },
])("rejects invalid selectors before provider reads %#", async (change) => {
  const f = fixture();
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, { ...f.opts, ...change }),
  ).rejects.toThrow();
  expect(f.retrieve).not.toHaveBeenCalled();
  expect(f.list).not.toHaveBeenCalled();
});
it("binds continuation to invoice, buyer and subscription selectors", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [f.payment()], has_more: true } as never);
  const first = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  for (const change of [
    { stripeInvoiceId: "in_other" },
    { customerAccount: "acct_other" },
    { stripeSubscriptionId: "sub_other" },
  ])
    await expect(
      f.client.getInvoicePaymentPageFromStripe(f.ctx, {
        ...f.opts,
        ...change,
        cursor: first.continueCursor,
      }),
    ).rejects.toThrow();
  expect(f.retrieve).toHaveBeenCalledTimes(1);
  expect(f.list).toHaveBeenCalledTimes(1);
});
it("propagates provider failure without an empty success page", async () => {
  const f = fixture();
  f.retrieve.mockRejectedValue(new Error("Provider unavailable"));
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow("Provider unavailable");
  expect(f.list).not.toHaveBeenCalled();
});

it("preserves open and canceled rows, null and zero paid amounts and original currency units", async () => {
  const f = fixture();
  const open = {
    ...f.payment("inpay_open"),
    status: "open",
    amount_paid: null,
    currency: "isk",
  };
  const canceled = {
    ...f.payment("inpay_canceled"),
    status: "canceled",
    amount_paid: 0,
    currency: "huf",
  };
  f.list.mockResolvedValue({
    data: [open, canceled],
    has_more: false,
  } as never);
  const result = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  expect(result.page.map((row) => row.invoicePayment)).toEqual([
    open,
    canceled,
  ]);
  expect(result).not.toHaveProperty("eligible");
  expect(result).not.toHaveProperty("refundableAmount");
});
it("resolves expanded canonical references without using metadata or invoice previews", async () => {
  const f = fixture();
  const row = {
    ...f.payment(),
    invoice: { id: "in_buyer" },
    payment: { type: "payment_intent", payment_intent: { id: "pi_expanded" } },
  };
  f.retrieve.mockResolvedValue({
    ...f.invoice,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: { id: "sub_buyer" } },
    },
  } as never);
  f.list.mockResolvedValue({ data: [row], has_more: false } as never);
  expect(
    (await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts)).page[0]
      ?.paymentIntentId,
  ).toBe("pi_expanded");
});
it("retains unknown payment types and malformed PaymentIntent identifiers as unsupported or unavailable", async () => {
  const f = fixture();
  f.list.mockResolvedValue({
    data: [
      f.payment("inpay_future", "future_type", "anything"),
      f.payment("inpay_bad", "payment_intent", "ch_wrong"),
    ],
    has_more: false,
  } as never);
  const result = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  expect(result.page.map((row) => row.referenceStatus)).toEqual([
    "unsupported",
    "unavailable",
  ]);
  expect(result.page.every((row) => row.paymentIntentId === null)).toBe(true);
});
it.each([
  { data: [], has_more: true },
  { data: [{ id: "inpay_foreign", invoice: "in_foreign" }], has_more: false },
  { data: [{ id: "bad", invoice: "in_buyer" }], has_more: false },
])(
  "rejects malformed provider pages instead of inventing completion %#",
  async (response) => {
    const f = fixture();
    f.list.mockResolvedValue(response as never);
    await expect(
      f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts),
    ).rejects.toThrow();
  },
);
it("allows a terminal empty page", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [], has_more: false } as never);
  expect(await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts)).toEqual(
    {
      scope: f.opts,
      page: [],
      hasMore: false,
      continueCursor: null,
    },
  );
});
it("rejects a provider page exceeding the requested bound", async () => {
  const f = fixture();
  f.list.mockResolvedValue({
    data: [f.payment(), f.payment("inpay_second")],
    has_more: false,
  } as never);
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, { ...f.opts, limit: 1 }),
  ).rejects.toThrow();
});
it("propagates payment-list failure after verified invoice scope", async () => {
  const f = fixture();
  f.list.mockRejectedValue(new Error("Payment list unavailable"));
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow("Payment list unavailable");
});
it("rejects nonadvancing continuation instead of repeating indefinitely", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [f.payment()], has_more: true } as never);
  const first = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, {
      ...f.opts,
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow(/continuation/);
});

it("rejects duplicate and repeated boundary payment rows", async () => {
  const f = fixture();
  f.list.mockResolvedValueOnce({
    data: [f.payment()],
    has_more: true,
  } as never);
  const first = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  f.list.mockResolvedValueOnce({
    data: [f.payment(), f.payment("inpay_second")],
    has_more: false,
  } as never);
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, {
      ...f.opts,
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow();
  f.list.mockResolvedValueOnce({
    data: [f.payment("inpay_second"), f.payment("inpay_second")],
    has_more: false,
  } as never);
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts),
  ).rejects.toThrow();
});

it.each([
  { amount_paid: Number.MAX_SAFE_INTEGER + 1 },
  { amount_paid: -1 },
  { amount_requested: 1.5 },
  { amount_requested: Number.NaN },
  { currency: "" },
])(
  "rejects unrepresentable original payment units instead of returning rounded evidence %#",
  async (change) => {
    const f = fixture();
    f.list.mockResolvedValue({
      data: [{ ...f.payment(), ...change }],
      has_more: false,
    } as never);
    await expect(
      f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts),
    ).rejects.toThrow(/units|currency/);
  },
);

it("rejects noncanonical and invalid-schema cursor payloads before provider reads", async () => {
  const f = fixture();
  const payload = btoa(
    JSON.stringify({ version: 2, scope: f.opts, after: "inpay_previous" }),
  );
  for (const cursor of ["%%%", payload, `${payload}=`]) {
    await expect(
      f.client.getInvoicePaymentPageFromStripe(f.ctx, { ...f.opts, cursor }),
    ).rejects.toThrow(/cursor/);
  }
  expect(f.retrieve).not.toHaveBeenCalled();
  expect(f.list).not.toHaveBeenCalled();
});
it("revalidates invoice ownership on continuation instead of trusting a previous successful page", async () => {
  const f = fixture();
  f.list.mockResolvedValue({ data: [f.payment()], has_more: true } as never);
  const first = await f.client.getInvoicePaymentPageFromStripe(f.ctx, f.opts);
  f.retrieve.mockResolvedValue({
    ...f.invoice,
    customer_account: "acct_foreign",
  } as never);
  await expect(
    f.client.getInvoicePaymentPageFromStripe(f.ctx, {
      ...f.opts,
      cursor: first.continueCursor,
    }),
  ).rejects.toThrow(/scope/);
  expect(f.list).toHaveBeenCalledTimes(1);
});
