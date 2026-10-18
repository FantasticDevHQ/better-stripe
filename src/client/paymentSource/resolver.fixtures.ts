import type Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { BetterStripe } from "../index.js";
import { getStripeClient, type Component, type RunCtx } from "../helpers.js";

export interface SourceHttpClient extends Stripe.HttpClient {}
export function fixture() {
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
  const extra = new Map<string, unknown>();
  (
    sdk as unknown as { _setApiField: (name: string, value: unknown) => void }
  )._setApiField("httpClient", {
    getClientName: () => "verified-source-contract",
    makeRequest: async (
      ...[, , path, method, headers, body]: Parameters<
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
      const handler = extra.get(url.pathname);
      const data =
        (typeof handler === "function" ? handler(method, body) : handler) ??
        (url.pathname === "/v1/payment_intents/pi_source"
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
                });
      return {
        getStatusCode: () => 200,
        getHeaders: () => ({}),
        getRawResponse: () => ({}),
        toJSON: async () => JSON.parse(JSON.stringify(data)),
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
    sdk,
    httpClient: (
      sdk as unknown as { getApiField(name: string): SourceHttpClient }
    ).getApiField("httpClient"),
    extra,
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
