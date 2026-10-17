import type Stripe from "stripe";
import { expect, it, vi } from "vitest";
import { BetterStripe } from "../index.js";
import { getStripeClient } from "../helpers.js";

function fixture(failure = false) {
  const key = `sk_test_exact_invoice_http_${crypto.randomUUID()}`;
  const client = new BetterStripe({} as never, { STRIPE_SECRET_KEY: key });
  const calls: { method: string; path: string; realm: string | undefined }[] =
    [];
  const sdk = getStripeClient(key);
  const invoice = {
    id: "in_original",
    customer_account: "acct_original",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: { id: "sub_original" } },
    },
  };
  const row = {
    id: "inpay_original",
    object: "invoice_payment",
    invoice: { id: "in_original" },
    amount_paid: null,
    amount_requested: 1200,
    currency: "jpy",
    status: "open",
    payment: { type: "payment_intent", payment_intent: { id: "pi_original" } },
  };
  (
    sdk as unknown as { _setApiField: (key: string, value: unknown) => void }
  )._setApiField("httpClient", {
    getClientName: () => "exact-invoice-payment-test",
    makeRequest: async (
      ...[, , path, method, headers]: Parameters<
        ReturnType<typeof Stripe.createNodeHttpClient>["makeRequest"]
      >
    ) => {
      calls.push({
        method,
        path,
        realm: headers["Stripe-Account"] as string | undefined,
      });
      const isExact = path === "/v1/invoice_payments/inpay_original";
      const data =
        failure && isExact
          ? {
              error: {
                type: "invalid_request_error",
                message: "synthetic inaccessible payment",
              },
            }
          : isExact
            ? row
            : invoice;
      return {
        getStatusCode: () => (failure && isExact ? 404 : 200),
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () => data,
        toStream: () => {
          throw new Error("Unexpected stream");
        },
      };
    },
  });
  const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
  const options = {
    stripeInvoicePaymentId: "inpay_original",
    stripeInvoiceId: "in_original",
    customerAccount: "acct_original",
    stripeSubscriptionId: "sub_original",
  };
  return { client, calls, ctx, options, row };
}

it("uses exact platform GET paths through the actual Stripe HTTP boundary, without list or writes", async () => {
  const f = fixture();
  const result = await f.client.getInvoicePaymentFromStripe(f.ctx, f.options);
  expect(result.invoicePayment).toEqual(f.row);
  expect(result.paymentIntentId).toBe("pi_original");
  expect(f.calls).toEqual([
    { method: "GET", path: "/v1/invoices/in_original", realm: undefined },
    {
      method: "GET",
      path: "/v1/invoice_payments/inpay_original",
      realm: undefined,
    },
  ]);
  expect(f.ctx.runQuery).not.toHaveBeenCalled();
  expect(f.ctx.runMutation).not.toHaveBeenCalled();
});

it("propagates an actual Stripe HTTP resource error rather than an empty result", async () => {
  const f = fixture(true);
  await expect(
    f.client.getInvoicePaymentFromStripe(f.ctx, f.options),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(f.calls).toHaveLength(2);
  expect(f.ctx.runMutation).not.toHaveBeenCalled();
});
