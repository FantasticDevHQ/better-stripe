import Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { schema, modules } from "../../test.js";
import { initConvexTest } from "../setup.test.js";
import type { Component } from "../helpers.js";
import { nativeSubscription } from "./subscription.fixtures.js";
export function fixture(
  external = false,
  failCreate = false,
): {
  t: ReturnType<typeof initConvexTest>;
  component: Component;
  stripe: Stripe;
  httpClient: Stripe.HttpClient;
  calls: Array<{
    path: string;
    method: string;
    body: URLSearchParams;
    key: string | null;
  }>;
  state: {
    native?: ReturnType<typeof nativeSubscription> & {
      metadata?: Record<string, string>;
    };
    session?: Record<string, unknown>;
    missingNative?: boolean;
    realmId?: string;
  };
} {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  const component = componentsGeneric().betterStripe as unknown as Component;
  const calls: Array<{
    path: string;
    method: string;
    body: URLSearchParams;
    key: string | null;
  }> = [];
  type Native = ReturnType<typeof nativeSubscription> & {
    metadata?: Record<string, string>;
  };
  const state: {
    native?: Native;
    session?: Record<string, unknown>;
    missingNative?: boolean;
    realmId?: string;
  } = {};
  const httpClient: Stripe.HttpClient = Stripe.createFetchHttpClient(
    async (input, init) => {
      const path = new URL(String(input)).pathname,
        method = init?.method ?? "GET",
        body = new URLSearchParams(String(init?.body ?? ""));
      calls.push({
        path,
        method,
        body,
        key: new Headers(init?.headers).get("idempotency-key"),
      });
      let value: unknown;
      if (path === "/v1/account")
        value = { id: state.realmId ?? "acct_platform" };
      else if (path === "/v1/balance") value = { livemode: false };
      else if (path === "/v1/customers/acct_buyer")
        value = {
          id: "cus_buyer",
          customer_account: "acct_buyer",
          livemode: false,
        };
      else if (path === "/v1/subscriptions" && method === "GET")
        value = {
          data: state.native
            ? [state.native]
            : external
              ? [nativeSubscription()]
              : [],
          has_more: false,
        };
      else if (path === "/v1/subscriptions" && method === "POST") {
        if (failCreate) throw new Error("private transport failure");
        state.native = {
          ...nativeSubscription(),
          metadata: { bsUsageIntent: body.get("metadata[bsUsageIntent]")! },
        };
        value = state.native;
      } else if (path === "/v1/subscriptions/sub_calls") {
        if (state.missingNative)
          return new Response(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                code: "resource_missing",
                message: "private missing identity",
              },
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        if (method === "POST" && state.native)
          state.native.cancel_at_period_end =
            body.get("cancel_at_period_end") === "true";
        value = state.native;
      } else if (path === "/v1/checkout/sessions" && method === "GET")
        value = { data: state.session ? [state.session] : [], has_more: false };
      else if (path === "/v1/checkout/sessions" && method === "POST") {
        state.session = {
          id: "cs_test_example",
          mode: "subscription",
          status: "open",
          livemode: false,
          customer_account: "acct_buyer",
          customer: "cus_buyer",
          metadata: { bsUsageIntent: body.get("metadata[bsUsageIntent]") },
          url: "https://checkout.stripe.test/example",
          subscription: null,
        };
        value = state.session;
      } else if (path === "/v1/checkout/sessions/cs_test_example")
        value = state.session;
      else if (path === "/v1/invoices/in_closeout")
        value = {
          id: "in_closeout",
          livemode: false,
          customer_account: "acct_buyer",
          customer: "cus_buyer",
          currency: "usd",
          status: "paid",
          billing_reason: "subscription_cycle",
          period_start: 600,
          period_end: 1200,
          status_transitions: { finalized_at: 1300 },
          amount_due: 1010,
          amount_paid: 1010,
          total: 1010,
          parent: {
            subscription_details: {
              subscription: "sub_calls",
              metadata: state.native?.metadata ?? {},
            },
          },
          lines: {
            has_more: false,
            data: [
              {
                id: "il_usage",
                currency: "usd",
                amount: 10,
                quantity_decimal: "15",
                quantity: 15,
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
                period: { start: 600, end: 1200 },
                pretax_credit_amounts: [],
              },
            ],
          },
        };
      else if (path.startsWith("/v1/prices/")) {
        const metered = path.endsWith("price_calls");
        value = {
          id: metered ? "price_calls" : "price_base",
          active: true,
          livemode: false,
          product: "prod_calls",
          lookup_key: "calls",
          currency: "usd",
          type: "recurring",
          transform_quantity: null,
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: metered ? "metered" : "licensed",
            ...(metered ? { meter: "mtr_calls" } : {}),
          },
          ...(metered
            ? {
                billing_scheme: "tiered",
                tiers_mode: "graduated",
                tiers: [
                  { up_to: 10, unit_amount: 0 },
                  { up_to: null, unit_amount: 2 },
                ],
              }
            : { billing_scheme: "per_unit", unit_amount: 1000 }),
        };
      } else if (path === "/v1/billing/meters/mtr_calls")
        value = {
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
        };
      else throw new Error(`Unexpected test path ${path}`);
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const stripe = new Stripe("sk_test_subscription", {
    maxNetworkRetries: 0,
    httpClient,
  });
  return { t, component, stripe, calls, httpClient, state };
}
