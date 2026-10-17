import Stripe from "stripe";
import workflowTest from "@convex-dev/workflow/test";
import { componentsGeneric, type FunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { CostRecoveryClient } from "../costRecovery.js";
import type { Component, RunCtx } from "../helpers.js";
import type { ProcessingCostProviderRequest } from "./contracts.js";
const modules = import.meta.glob("../../component/**/*.ts");
const nested = componentsGeneric();
const scope = { accountId: "acct_seller", scopeKey: "store", currency: "usd" };
async function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, modules);
  workflowTest.register(t, "betterStripe/workflow");
  const client = new CostRecoveryClient(
    nested.betterStripe as unknown as Component,
  );
  let writes = 0;
  const ctx = {
    runQuery: (
      ref: FunctionReference<"query">,
      args: Record<string, unknown>,
    ) => t.query(ref, args),
    runMutation: (
      ref: FunctionReference<"mutation">,
      args: Record<string, unknown>,
    ) => {
      writes++;
      return t.mutation(ref, args);
    },
  } as unknown as RunCtx;
  const op = await t.mutation(
    nested.betterStripe.processingCostReconciliation.mutations.start,
    {
      ...scope,
      claimKey: "cost:pi_a",
      requestKey: "provider-refund",
      expectedRevision: -1,
      source: {
        kind: "sale",
        paymentIntentId: "pi_a",
        gross: 1000,
        customerAccountId: "acct_buyer",
        invoiceId: "in_a",
        stripeAccountId: "acct_connected",
      },
      policy: {
        sellingFee: 100,
        liability: { processingCosts: "uncovered", disputeCosts: "all" },
        rounding: "nearest",
      },
      provider: "function://fixture/provider",
      providerApiVersion: "2026-09-30.endive",
      definitionVersion: 1,
      maxAttempts: 3,
      retryDelayMs: 1,
    },
  );
  const request: ProcessingCostProviderRequest = {
    ...scope,
    operationId: op.operationId,
    version: op.version,
    providerApiVersion: "2026-09-30.endive",
    definitionVersion: 1,
  };
  const tx = (id: string, source: string, amount: number, fee: number) => ({
    id,
    object: "balance_transaction",
    source,
    amount,
    fee,
    net: amount - fee,
    currency: "usd",
    created: 1,
    fee_details: [],
  });
  const payment = {
    id: "pi_a",
    object: "payment_intent",
    status: "succeeded",
    amount: 1000,
    amount_received: 1000,
    currency: "usd",
    customer_account: "acct_buyer",
    livemode: false,
    metadata: { stripePriceId: "price_current", private: "sk_test_PRIVATE" },
    latest_charge: {
      id: "ch_a",
      object: "charge",
      payment_intent: "pi_a",
      amount: 1000,
      amount_captured: 1000,
      currency: "usd",
      paid: true,
      captured: true,
      status: "succeeded",
      amount_refunded: 500,
      disputed: true,
      livemode: false,
      balance_transaction: tx("txn_charge", "ch_a", 1000, 30),
    },
  };
  const invoice = {
    id: "in_a",
    object: "invoice",
    status: "paid",
    currency: "usd",
    amount_paid: 1000,
    amount_due: 1000,
    amount_remaining: 0,
    total: 1000,
    amount_overpaid: 0,
    customer_account: "acct_buyer",
    livemode: false,
  };
  const funding = {
    id: "inpay_a",
    object: "invoice_payment",
    invoice: "in_a",
    status: "paid",
    currency: "usd",
    amount_paid: 1000,
    amount_requested: 1000,
    livemode: false,
    payment: { type: "payment_intent", payment_intent: "pi_a" },
  };
  const line = {
    id: "il_a",
    object: "line_item",
    invoice: "in_a",
    currency: "usd",
    amount: 1000,
    quantity: 1,
    livemode: false,
    parent: {
      type: "invoice_item_details",
      invoice_item_details: { proration: false },
    },
    pricing: {
      type: "price_details",
      price_details: { price: "price_original", product: "prod_original" },
    },
  };
  const refund = {
    id: "re_a",
    object: "refund",
    amount: 500,
    status: "succeeded",
    currency: "usd",
    charge: "ch_a",
    payment_intent: "pi_a",
    balance_transaction: tx("txn_refund", "re_a", -500, -5),
    failure_balance_transaction: null,
  };
  const dispute = {
    id: "dp_a",
    object: "dispute",
    amount: 600,
    status: "lost",
    currency: "usd",
    charge: "ch_a",
    payment_intent: "pi_a",
    balance_transactions: [tx("txn_dispute", "dp_a", -600, 15)],
  };
  const pages = new Map<string, unknown>();
  const requests: {
    path: string;
    method: string;
    authenticated: boolean;
    version: string | null;
    account: string | null;
  }[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    const u = new URL(String(url));
    const h = new Headers(init?.headers);
    requests.push({
      path: u.pathname,
      method: init?.method ?? "GET",
      authenticated: h.get("Authorization") === "Bearer sk_test_runtime_only",
      version: h.get("Stripe-Version"),
      account: h.get("Stripe-Account"),
    });
    const data =
      pages.get(u.pathname) ??
      (u.pathname.includes("/payment_intents/")
        ? payment
        : u.pathname.endsWith("/lines")
          ? { object: "list", data: [line], has_more: false }
          : u.pathname.includes("/invoices/")
            ? invoice
            : u.pathname.endsWith("/invoice_payments")
              ? { object: "list", data: [funding], has_more: false }
              : u.pathname.endsWith("/refunds")
                ? { object: "list", data: [refund], has_more: false }
                : { object: "list", data: [dispute], has_more: false });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    t,
    client,
    ctx,
    request,
    httpClient,
    requests,
    pages,
    payment,
    refund,
    dispute,
    writes: () => writes,
  };
}
it("uses real Stripe transport, original provenance and signed refunds/disputes without provider or ledger writes", async () => {
  const f = await fixture();
  const receipt = await f.client.observeProcessingCosts(f.ctx, f.request, {
    stripeSecretKey: "sk_test_runtime_only",
    httpClient: f.httpClient,
  });
  expect(receipt).toMatchObject({
    outcome: {
      status: "ready",
      value: {
        sourceChargeId: "ch_a",
        gross: 1000,
        originalProcessingFee: 30,
        processingFee: 25,
        disputeFees: 15,
        principalReturned: 1000,
        provenance: {
          invoiceId: "in_a",
          invoicePaymentId: "inpay_a",
          stripePriceId: "price_original",
          stripeProductId: "prod_original",
        },
      },
    },
  });
  expect(JSON.stringify(receipt)).not.toContain("sk_test_PRIVATE");
  expect(JSON.stringify(receipt)).not.toContain("price_current");
  expect(
    f.requests.every(
      (r) =>
        r.method === "GET" &&
        r.authenticated &&
        r.version === f.request.providerApiVersion &&
        r.account === "acct_connected",
    ),
  ).toBe(true);
  expect(f.writes()).toBe(0);
});
it.each(["/v1/refunds", "/v1/disputes"])(
  "holds malformed or incomplete %s history without inventing zero costs",
  async (path) => {
    const f = await fixture();
    f.pages.set(path, { object: "list", data: [], has_more: true });
    expect(
      await f.client.observeProcessingCosts(f.ctx, f.request, {
        stripeSecretKey: "sk_test_runtime_only",
        httpClient: f.httpClient,
      }),
    ).toMatchObject({
      outcome: {
        status: "unknown",
        reason: "history_incomplete",
        retryable: false,
      },
    });
    expect(f.writes()).toBe(0);
  },
);
it("never contacts the provider for a changed pinned API version", async () => {
  const f = await fixture();
  expect(
    await f.client.observeProcessingCosts(
      f.ctx,
      { ...f.request, providerApiVersion: "2026-01-01.changed" },
      { stripeSecretKey: "sk_test_runtime_only", httpClient: f.httpClient },
    ),
  ).toMatchObject({
    outcome: { status: "conflict", reason: "identity_changed" },
  });
  expect(f.requests).toEqual([]);
});
