import Stripe from "stripe";
import { convexToJson } from "convex/values";
import { expect, it } from "vitest";
import { STRIPE_API_VERSION } from "../constants.js";
import { prepareUsageRecord } from "./records.js";
import { observeUsageInvoice } from "./invoiceObservation.js";
const scope = {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  period = { start: 600, end: 1200 };
const binding = prepareUsageRecord({
  scope,
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "pay_as_you_go",
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
    },
  },
  sourceEventId: "read",
  quantity: "0",
  occurredAt: 600,
}).binding;
const options = {
  scope,
  binding,
  subscription: {
    subscriptionId: "sub_calls",
    subscriptionItemId: "si_calls",
    stripePriceId: "price_calls",
    period,
    interval: "month" as const,
  },
  period,
};
function setup(hasMore = false, wrongPayer = false, missingQuantity = false) {
  const requests: Array<{ method: string; path: string }> = [];
  const stripe = new Stripe("sk_test_invoice_read", {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (input, init) => {
      const url = new URL(String(input)),
        path = url.pathname;
      requests.push({ method: init?.method ?? "GET", path });
      const result =
        path === "/v1/account"
          ? { id: "acct_platform" }
          : path === "/v1/balance"
            ? { livemode: false }
            : path === "/v1/billing/meters/mtr_calls"
              ? {
                  id: "mtr_calls",
                  livemode: false,
                  status: "active",
                  event_name: "calls",
                  default_aggregation: { formula: "sum" },
                  customer_mapping: {
                    type: "by_id",
                    event_payload_key: "stripe_customer_id",
                  },
                  value_settings: { event_payload_key: "value" },
                  event_time_window: null,
                }
              : path === "/v1/subscriptions/sub_calls"
                ? {
                    id: "sub_calls",
                    livemode: false,
                    customer: "cus_buyer",
                    customer_account: "acct_buyer",
                  }
                : {
                    id: "in_one",
                    object: "invoice",
                    livemode: false,
                    customer_account: wrongPayer ? "acct_other" : "acct_buyer",
                    customer: "cus_buyer",
                    currency: "usd",
                    status: path.endsWith("create_preview") ? "draft" : "paid",
                    status_transitions: {
                      finalized_at: path.endsWith("create_preview")
                        ? null
                        : 1200,
                    },
                    amount_due: 20,
                    amount_paid: 20,
                    total: 20,
                    parent: {
                      subscription_details: { subscription: "sub_calls" },
                    },
                    lines: {
                      data: [
                        {
                          id: "il_one",
                          object: "line_item",
                          currency: "usd",
                          amount: 10,
                          quantity: 2,
                          quantity_decimal: missingQuantity ? null : "2.5",
                          pricing: {
                            type: "price_details",
                            price_details: { price: "price_calls" },
                            unit_amount_decimal: null,
                          },
                          parent: {
                            subscription_item_details: {
                              subscription: "sub_calls",
                              subscription_item: "si_calls",
                              proration: false,
                            },
                          },
                          period,
                          pretax_credit_amounts: [],
                        },
                      ],
                      has_more: hasMore,
                    },
                  };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  });
  return { stripe, requests };
}
it("distinguishes full invoice amounts and matching metered lines with decimal quantities", async () => {
  const f = setup(),
    result = await observeUsageInvoice(f.stripe, options, "in_one");
  expect(result).toMatchObject({
    status: "available",
    value: {
      kind: "invoice",
      invoiceId: "in_one",
      finalized: true,
      amountDue: "20",
      amountPaid: "20",
      total: "20",
      meterAmount: {
        status: "available",
        value: { amount: "10", currency: "usd" },
      },
      lines: [{ quantity: "2.5", unitAmountDecimal: null }],
    },
  });
  expect(() => convexToJson(result)).not.toThrow();
  expect(f.requests.every((r) => r.method === "GET")).toBe(true);
});
it("does not call a preview finalized or an incomplete line page a complete meter amount", async () => {
  const f = setup(true),
    result = await observeUsageInvoice(f.stripe, options);
  expect(result).toMatchObject({
    status: "available",
    value: {
      kind: "preview",
      finalized: false,
      linesComplete: false,
      meterAmount: {
        status: "unavailable",
        reason: "invoice_history_incomplete",
      },
    },
  });
  expect(f.requests.filter((r) => r.method === "POST")).toEqual([
    { method: "POST", path: "/v1/invoices/create_preview" },
  ]);
});
it("rejects another payer's invoice", async () => {
  expect(
    await observeUsageInvoice(setup(false, true).stripe, options, "in_one"),
  ).toMatchObject({
    status: "unsupported",
    reason: "invoice_binding_mismatch",
  });
});

it("does not treat the legacy truncated invoice quantity as full precision", async () => {
  expect(
    await observeUsageInvoice(
      setup(false, false, true).stripe,
      options,
      "in_one",
    ),
  ).toMatchObject({
    status: "available",
    value: { lines: [{ quantity: null, providerQuantityDecimal: null }] },
  });
});
