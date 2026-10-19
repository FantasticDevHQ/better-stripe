import { beforeEach, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  raw: {
    prices: { retrieve: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    invoices: { list: vi.fn(), retrieve: vi.fn(), listLineItems: vi.fn() },
    invoicePayments: { list: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
  },
  pin: vi.fn(),
}));
vi.mock("./native", () => ({ observeEnrollment: mocks.observe }));
vi.mock("../stripe/client", () => ({ getStripeClient: () => mocks.raw }));
import { paidEnrollment } from "./payment";
const ref = {
  actorId: "buyer" as Id<"users">,
  enrollmentId: "enrollment" as Id<"meteredProductEnrollments">,
};
const ctx = { runMutation: mocks.pin } as unknown as ActionCtx;
function setup() {
  const invoice = {
    id: "in_original",
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_original" } },
    amount_paid: 2000,
    amount_due: 2000,
    total: 2000,
    amount_remaining: 0,
    amount_overpaid: 0,
    livemode: false,
    status: "paid",
    billing_reason: "subscription_create",
  };
  const payment = {
    id: "pi_original",
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    currency: "usd",
    amount_received: 2000,
    livemode: false,
    status: "succeeded",
    latest_charge: {
      id: "ch_original",
      payment_intent: "pi_original",
      customer: "cus_buyer",
      currency: "usd",
      amount_captured: 2000,
      amount_refunded: 0,
      disputed: false,
      paid: true,
      captured: true,
      livemode: false,
    },
  };
  const subscription = {
    id: "sub_original",
    latest_invoice: "in_original",
    customer: "cus_buyer",
    customer_account: "acct_buyer",
    livemode: false,
    status: "active",
    currency: "usd",
    billing_mode: { type: "flexible" },
    collection_method: "charge_automatically",
    default_payment_method: "pm_original",
    cancel_at_period_end: false,
    items: {
      has_more: false,
      data: [
        {
          id: "si_base",
          current_period_start: 600,
          current_period_end: 900,
          quantity: 1,
          price: { id: "price_base" },
        },
      ],
    },
  };
  mocks.observe.mockResolvedValue({
    offer: { productId: "prod_coaching", baseAmount: 2000 },
    enrollment: { _id: "enrollment" },
    provider: { basePriceId: "price_base", price: { currency: "usd" } },
    payer: { accountId: "acct_buyer", customerId: "cus_buyer" },
    subscription: {
      subscriptionId: "sub_original",
      status: "active",
      currency: "usd",
      billingMode: "flexible",
      cancelAtPeriodEnd: false,
      collection: {
        method: "charge_automatically",
        defaultPaymentMethod: "pm_original",
      },
      items: [
        {
          id: "si_base",
          stripePriceId: "price_base",
          period: { start: 600, end: 900 },
          quantity: "1",
        },
      ],
    },
    meter: {
      binding: { plan: { model: "included_overage" } },
      subscription: { period: { start: 600, end: 900 } },
    },
  });
  mocks.raw.prices.retrieve.mockResolvedValue({
    product: "prod_coaching",
    active: true,
    livemode: false,
    unit_amount: 2000,
    currency: "usd",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  });
  mocks.raw.subscriptions.retrieve.mockResolvedValue(subscription);
  mocks.raw.invoices.list.mockResolvedValue({
    data: [invoice],
    has_more: false,
  });
  mocks.raw.invoices.retrieve.mockResolvedValue(invoice);
  mocks.raw.invoices.listLineItems.mockResolvedValue({
    data: [
      {
        pricing: {
          price_details: { price: "price_base", product: "prod_coaching" },
        },
        quantity: 1,
        amount: 2000,
        period: { start: 600, end: 900 },
      },
    ],
    has_more: false,
  });
  mocks.raw.invoicePayments.list.mockResolvedValue({
    data: [
      {
        invoice: "in_original",
        livemode: false,
        currency: "usd",
        status: "paid",
        amount_paid: 2000,
        amount_requested: 2000,
        payment: { type: "payment_intent", payment_intent: "pi_original" },
      },
    ],
    has_more: false,
  });
  mocks.raw.paymentIntents.retrieve.mockResolvedValue(payment);
  return { invoice, payment, subscription };
}
beforeEach(() => vi.clearAllMocks());
it("pins the original initial invoice only after full captured payment verification", async () => {
  setup();
  await paidEnrollment(ctx, ref);
  expect(mocks.pin).toHaveBeenCalledWith(expect.anything(), {
    ...ref,
    initialInvoiceId: "in_original",
  });
});
it.each([
  "subscription",
  "invoice",
  "payment",
  "charge_customer",
  "refund",
  "dispute",
  "credit_covered",
  "partial_history",
  "base_product",
  "period",
  "canceled_subscription",
  "changed_subscription_period",
])(
  "holds work for %s evidence mismatch and never poisons the original invoice pin",
  async (kind) => {
    const f = setup();
    if (kind === "canceled_subscription") f.subscription.status = "canceled";
    if (kind === "changed_subscription_period")
      f.subscription.items.data[0].current_period_end = 901;
    if (kind === "subscription") f.subscription.id = "sub_foreign";
    if (kind === "invoice") f.invoice.id = "in_foreign";
    if (kind === "payment") f.payment.id = "pi_foreign";
    if (kind === "charge_customer")
      f.payment.latest_charge.customer = "cus_foreign";
    if (kind === "refund") f.payment.latest_charge.amount_refunded = 1;
    if (kind === "dispute") f.payment.latest_charge.disputed = true;
    if (kind === "credit_covered") f.invoice.amount_paid = 0;
    if (kind === "partial_history")
      mocks.raw.invoices.listLineItems.mockResolvedValue({
        data: [],
        has_more: true,
      });
    if (kind === "base_product")
      mocks.raw.prices.retrieve.mockResolvedValue({ product: "prod_foreign" });
    if (kind === "period")
      mocks.raw.invoices.listLineItems.mockResolvedValue({
        data: [
          {
            pricing: {
              price_details: { price: "price_base", product: "prod_coaching" },
            },
            quantity: 1,
            amount: 2000,
            period: { start: 1, end: 2 },
          },
        ],
        has_more: false,
      });
    await expect(paidEnrollment(ctx, ref)).rejects.toThrow();
    expect(mocks.pin).not.toHaveBeenCalled();
  },
);

it("refuses prepaid work on automatic collection even with an active subscription", async () => {
  mocks.observe.mockResolvedValue({
    offer: {},
    provider: { basePriceId: null },
    payer: {},
    enrollment: {},
    meter: { binding: { plan: { model: "prepaid" } } },
    subscription: {
      status: "active",
      collection: { method: "charge_automatically" },
    },
  });
  await expect(paidEnrollment(ctx, ref)).rejects.toThrow(
    /manual invoice collection/,
  );
  expect(mocks.raw.paymentIntents.retrieve).not.toHaveBeenCalled();
});
