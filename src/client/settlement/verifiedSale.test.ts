import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import { getVerifiedSale } from "./verifiedSale.js";
function fixture() {
  const payment = {
    id: "pi_1",
    status: "succeeded",
    currency: "usd",
    amount_received: 10000,
    metadata: { seller: "store" },
    latest_charge: {
      id: "ch_1",
      amount: 10000,
      currency: "usd",
      amount_refunded: 0,
      disputed: false,
      balance_transaction: { currency: "usd", fee: 320 },
    },
  };
  const raw = {
    paymentIntents: { retrieve: vi.fn().mockResolvedValue(payment) },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        id: "sub_1",
        metadata: { ref: "a" },
        items: {
          data: [{ price: { id: "price_current", product: "prod_current" } }],
        },
      }),
    },
    invoices: {
      retrieve: vi.fn().mockResolvedValue({
        id: "in_1",
        status: "paid",
        amount_paid: 10000,
        currency: "usd",
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
    },
    invoicePayments: {
      list: vi.fn().mockResolvedValue({
        data: [{ status: "paid", payment: { payment_intent: "pi_1" } }],
        has_more: false,
      }),
    },
  };
  return { payment, raw, stripe: raw as unknown as Stripe };
}
it("returns actual fees, verified invoice linkage and current price instead of stale metadata", async () => {
  const { stripe, raw } = fixture();
  expect(
    await getVerifiedSale(stripe, {
      paymentIntentId: "pi_1",
      subscriptionId: "sub_1",
      invoiceId: "in_1",
    }),
  ).toMatchObject({
    status: "ready",
    chargeId: "ch_1",
    processingFee: 320,
    currency: "usd",
    stripePriceId: "price_current",
    stripeProductId: "prod_current",
    invoiceId: "in_1",
  });
  expect(raw.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", {
    expand: ["latest_charge.balance_transaction"],
  });
});
it("reports missing fees and unsuccessful payments as non-ready, never zero fees", async () => {
  const { stripe, raw, payment } = fixture();
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    latest_charge: { ...payment.latest_charge, balance_transaction: null },
  });
  expect(await getVerifiedSale(stripe, { paymentIntentId: "pi_1" })).toEqual({
    status: "pending",
    reason: "processing_fee_unavailable",
    retryable: true,
  });
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    status: "requires_payment_method",
  });
  expect(
    await getVerifiedSale(stripe, { paymentIntentId: "pi_1" }),
  ).toMatchObject({ status: "not_payable", retryable: false });
});
it("rejects mismatched currencies and unrelated invoice payments", async () => {
  const { stripe, raw, payment } = fixture();
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    latest_charge: {
      ...payment.latest_charge,
      balance_transaction: { currency: "eur", fee: 320 },
    },
  });
  await expect(
    getVerifiedSale(stripe, { paymentIntentId: "pi_1" }),
  ).rejects.toThrow();
  raw.paymentIntents.retrieve.mockResolvedValue(payment);
  raw.invoicePayments.list.mockResolvedValue({
    data: [{ status: "paid", payment: { payment_intent: "pi_other" } }],
    has_more: false,
  });
  await expect(
    getVerifiedSale(stripe, {
      paymentIntentId: "pi_1",
      invoiceId: "in_1",
      subscriptionId: "sub_1",
    }),
  ).rejects.toThrow();
});
it("marks processing payments as retryable without paying recipients", async () => {
  const { stripe, raw, payment } = fixture();
  raw.paymentIntents.retrieve.mockResolvedValue({
    ...payment,
    status: "processing",
  });
  expect(await getVerifiedSale(stripe, { paymentIntentId: "pi_1" })).toEqual({
    status: "pending",
    reason: "payment_processing",
    retryable: true,
  });
});

it("refuses partial invoice payments rather than awarding a fixed commission more than once", async () => {
  const { stripe, raw } = fixture();
  raw.invoices.retrieve.mockResolvedValue({
    id: "in_1",
    status: "paid",
    amount_paid: 20000,
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_1" } },
  });
  await expect(
    getVerifiedSale(stripe, { paymentIntentId: "pi_1", invoiceId: "in_1" }),
  ).rejects.toThrow("Partial invoice payments");
});
