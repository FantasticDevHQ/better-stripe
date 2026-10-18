import { vi } from "vitest";
import { fixture } from "./subscriptionTransport.fixtures.js";
import { request } from "./subscription.fixtures.js";
import { ensureManagedSubscription } from "./subscriptionProvider.js";
import type { RunCtx } from "../helpers.js";
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
export function creditFixture() {
  vi.useFakeTimers();
  vi.setSystemTime(700000);
  const calls: Array<{
    path: string;
    method: string;
    body: URLSearchParams;
    key: string | null;
  }> = [];
  const state = {
    paid: false,
    nativeApplied: 0,
    applyAtExpire: false,
    nativeExpired: false,
    incomplete: false,
    canceled: false,
    refunded: false,
    failGrant: false,
    wrongPayer: false,
    paymentId: "pi_topup1",
    grant: undefined as Record<string, unknown> | undefined,
    metadata: {} as Record<string, string>,
  };
  const f = fixture(false, false, async (input, init) => {
    const path = new URL(input).pathname,
      method = init?.method ?? "GET",
      body = new URLSearchParams(String(init?.body ?? ""));
    if (path === "/v1/prices/price_calls")
      return response({
        id: "price_calls",
        active: true,
        livemode: false,
        currency: "usd",
        type: "recurring",
        product: "prod_calls",
        lookup_key: "calls",
        billing_scheme: "per_unit",
        unit_amount_decimal: "2",
        transform_quantity: null,
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "metered",
          meter: "mtr_calls",
        },
      });
    if (path === "/v1/invoices/in_usage")
      return response({
        id: "in_usage",
        livemode: false,
        customer_account: "acct_foreign",
        customer: "cus_buyer",
        currency: "usd",
        status: "paid",
        status_transitions: { finalized_at: 1300 },
        parent: { subscription_details: { subscription: "sub_calls" } },
        lines: { has_more: false, data: [] },
      });
    if (path === "/v1/billing/credit_balance_summary")
      return response({
        customer: "cus_buyer",
        customer_account: "acct_buyer",
        livemode: false,
        balances: [
          {
            ledger_balance: {
              type: "monetary",
              monetary: {
                currency: "usd",
                value: state.nativeExpired ? 0 : 20 - state.nativeApplied,
              },
            },
            available_balance: {
              type: "monetary",
              monetary: {
                currency: "usd",
                value: state.nativeExpired ? 0 : 20 - state.nativeApplied,
              },
            },
          },
        ],
      });
    if (path === "/v1/billing/credit_balance_transactions")
      return response({
        data: [
          {
            id: "cbtxn_granted",
            object: "billing.credit_balance_transaction",
            credit_grant: "credgr_topup1",
            livemode: false,
            type: "credit",
            credit: {
              type: "credits_granted",
              amount: {
                type: "monetary",
                monetary: { currency: "usd", value: 20 },
              },
            },
            debit: null,
          },
          ...(state.nativeApplied
            ? [
                {
                  id: "cbtxn_applied",
                  object: "billing.credit_balance_transaction",
                  credit_grant: "credgr_topup1",
                  livemode: false,
                  type: "debit",
                  credit: null,
                  debit: {
                    type: "credits_applied",
                    amount: {
                      type: "monetary",
                      monetary: { currency: "usd", value: state.nativeApplied },
                    },
                    credits_applied: {
                      invoice: "in_usage",
                      invoice_line_item: "il_usage",
                    },
                  },
                },
              ]
            : []),
          ...(state.nativeExpired
            ? [
                {
                  id: "cbtxn_expired",
                  object: "billing.credit_balance_transaction",
                  credit_grant: "credgr_topup1",
                  livemode: false,
                  type: "debit",
                  credit: null,
                  debit: {
                    type: "credits_expired",
                    amount: {
                      type: "monetary",
                      monetary: {
                        currency: "usd",
                        value: 20 - state.nativeApplied,
                      },
                    },
                  },
                },
              ]
            : []),
        ],
        has_more: state.incomplete,
      });
    if (path.endsWith("/expire") && method === "POST") {
      if (state.applyAtExpire) state.nativeApplied = 20;
      state.nativeExpired = true;
      state.grant!.expires_at = 700;
      return response(state.grant);
    }
    if (
      !path.startsWith("/v1/payment_intents") &&
      !path.startsWith("/v1/billing/credit_grants")
    )
      return undefined;
    calls.push({
      path,
      method,
      body,
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    if (path === "/v1/payment_intents" && method === "GET")
      return response({
        data: state.metadata.bsUsageCredit ? [payment()] : [],
        has_more: false,
      });
    if (path === "/v1/payment_intents" && method === "POST") {
      state.metadata = { bsUsageCredit: body.get("metadata[bsUsageCredit]")! };
      return response(payment());
    }
    if (path.endsWith("/cancel")) state.canceled = true;
    if (path.startsWith("/v1/payment_intents/")) return response(payment());
    if (path === "/v1/billing/credit_grants" && method === "GET")
      return response({
        data: state.grant ? [state.grant] : [],
        has_more: false,
      });
    if (path === "/v1/billing/credit_grants" && method === "POST") {
      if (state.failGrant)
        throw new Error("private grant failure sk_test_dont_log");
      state.grant = {
        id: "credgr_topup1",
        object: "billing.credit_grant",
        livemode: false,
        customer_account: "acct_buyer",
        customer: "cus_buyer",
        category: "paid",
        amount: { type: "monetary", monetary: { currency: "usd", value: 20 } },
        applicability_config: { scope: { prices: [{ id: "price_calls" }] } },
        metadata: { bsUsageCredit: body.get("metadata[bsUsageCredit]") },
        effective_at: 700,
        expires_at: null,
        voided_at: null,
        created: 700,
        priority: 50,
      };
      return response(state.grant);
    }
    return response(state.grant);
  });
  function payment() {
    return {
      id: state.paymentId,
      object: "payment_intent",
      customer_account: state.wrongPayer ? "acct_other" : "acct_buyer",
      customer: "cus_buyer",
      livemode: false,
      currency: "usd",
      amount: 20,
      amount_received: state.paid ? 20 : 0,
      status: state.canceled
        ? "canceled"
        : state.paid
          ? "succeeded"
          : "requires_payment_method",
      metadata: state.metadata,
      client_secret: "pi_topup1_secret_private",
      latest_charge: state.paid
        ? {
            id: "ch_topup1",
            object: "charge",
            payment_intent: state.paymentId,
            paid: true,
            captured: true,
            status: "succeeded",
            amount: 20,
            amount_captured: 20,
            currency: "usd",
            livemode: false,
            refunded: state.refunded,
            amount_refunded: state.refunded ? 20 : 0,
            disputed: false,
          }
        : null,
    };
  }
  const meter = {
    ...request.meters[0],
    binding: {
      ...request.meters[0].binding,
      plan: {
        key: "calls",
        version: "v1",
        model: "prepaid" as const,
        unit: { name: "call", precision: 0 },
        rate: { currency: "usd", unitAmountDecimal: "2" },
        insufficientBalance: "reject" as const,
      },
    },
  };
  const purchase = {
    ...meter,
    purchaseId: "topup1",
    quantity: "10",
    ownership: "issuer" as const,
    rollover: "retain_original_terms" as const,
  };
  const ready = () =>
    f.t.action((ctx) =>
      ensureManagedSubscription(f.stripe, f.component, ctx as RunCtx, {
        ...request,
        meters: [meter],
      }),
    );
  return { ...f, calls, state, purchase, ready };
}
