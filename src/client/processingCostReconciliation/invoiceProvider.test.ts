import Stripe from "stripe";
import workflowTest from "@convex-dev/workflow/test";
import {
  componentsGeneric,
  mutationGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { expect, it } from "vitest";
import { initConvexTest } from "../setup.test.js";
import schema from "../../component/schema.js";
import { CostRecoveryClient } from "../costRecovery.js";
import type { Component, RunCtx } from "../helpers.js";
import type { ProcessingCostProviderRequest } from "./contracts.js";
const modules = import.meta.glob("../../component/**/*.ts");
const nested = componentsGeneric();
const scope = { accountId: "acct_owner", scopeKey: "store", currency: "usd" };
async function fixture() {
  const t = initConvexTest();
  t.registerComponent("betterStripe", schema, {
    ...modules,
    "../../component/fixture.ts": async () => ({
      seed: mutationGeneric({
        args: {},
        returns: v.any(),
        handler: async (ctx) => {
          const id = await ctx.db.insert("recoveryGroups", {
            ...scope,
            groupKey: "old-invoice",
            sourceKind: "invoice",
            sourceId: "in_original",
            invoiceItemId: "ii_original",
            amount: 80,
            maxDebit: 100,
            maxCredit: 0,
            pendingOperations: 0,
            status: "collected",
          });
          return ctx.db.get(id);
        },
      }),
    }),
  });
  workflowTest.register(t, "betterStripe/workflow");
  const group = await t.mutation(nested.betterStripe.fixture.seed, {});
  const op = await t.mutation(
    nested.betterStripe.processingCostReconciliation.mutations.start,
    {
      ...scope,
      claimKey: "cost:pi_a",
      requestKey: "invoice-refund",
      expectedRevision: -1,
      source: {
        kind: "invoice_recovery",
        paymentIntentId: "pi_a",
        gross: 1000,
        groupKey: "old-invoice",
      },
      rollback: { groupKey: "old-invoice", expectedRevision: -1 },
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
  const client = new CostRecoveryClient(
    nested.betterStripe as unknown as Component,
  );
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
    customer_account: scope.accountId,
    livemode: false,
    metadata: {},
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
      disputed: false,
      livemode: false,
      balance_transaction: tx("txn_charge", "ch_a", 1000, 30),
    },
  };
  const invoice = {
    id: "in_original",
    object: "invoice",
    status: "paid",
    currency: "usd",
    amount_paid: 1000,
    amount_due: 1000,
    total: 1000,
    amount_remaining: 0,
    amount_overpaid: 0,
    customer_account: scope.accountId,
    livemode: false,
  };
  const item = {
    id: "ii_original",
    object: "invoiceitem",
    invoice: "in_original",
    customer_account: scope.accountId,
    currency: "usd",
    amount: 80,
    discountable: false,
    metadata: { bsRecoveryGroup: group._id },
  };
  const funding = {
    id: "inpay_original",
    object: "invoice_payment",
    invoice: "in_original",
    status: "paid",
    currency: "usd",
    amount_paid: 1000,
    amount_requested: 1000,
    livemode: false,
    payment: { type: "payment_intent", payment_intent: "pi_a" },
  };
  const refund = {
    id: "re_a",
    object: "refund",
    amount: 500,
    status: "succeeded",
    currency: "usd",
    charge: "ch_a",
    payment_intent: "pi_a",
    balance_transaction: tx("txn_refund", "re_a", -500, 0),
    failure_balance_transaction: null,
  };
  const pages = new Map<string, unknown>();
  const requests: {
    path: string;
    method: string;
    authorized: boolean;
    version: string | null;
  }[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (url, init) => {
    const u = new URL(String(url));
    const h = new Headers(init?.headers);
    const phase = u.pathname.endsWith("/invoice_payments")
      ? u.searchParams.has("invoice")
        ? "forward"
        : "inverse"
      : u.pathname;
    requests.push({
      path: u.pathname,
      method: init?.method ?? "GET",
      authorized: h.get("Authorization") === "Bearer sk_test_runtime_only",
      version: h.get("Stripe-Version"),
    });
    const data =
      pages.get(phase) ??
      (u.pathname.includes("/payment_intents/")
        ? payment
        : u.pathname.includes("/invoices/")
          ? invoice
          : u.pathname.endsWith("/invoiceitems")
            ? { object: "list", data: [item], has_more: false }
            : u.pathname.endsWith("/invoice_payments")
              ? { object: "list", data: [funding], has_more: false }
              : u.pathname.endsWith("/refunds")
                ? { object: "list", data: [refund], has_more: false }
                : { object: "list", data: [], has_more: false });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    t,
    ctx,
    client,
    request,
    httpClient,
    pages,
    requests,
    group,
    payment,
    invoice,
    item,
    funding,
    refund,
    writes: () => writes,
  };
}
it("verifies collected group/item and full original funding independently of price metadata", async () => {
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
        principalReturned: 500,
        provenance: {
          invoiceId: "in_original",
          invoicePaymentId: "inpay_original",
          customerAccountId: scope.accountId,
          recoveryInvoiceItemId: "ii_original",
        },
      },
    },
  });
  expect(JSON.stringify(receipt)).not.toContain("stripePriceId");
  expect(f.writes()).toBe(0);
  expect(
    f.requests.every(
      (r) =>
        r.method === "GET" &&
        r.authorized &&
        r.version === f.request.providerApiVersion,
    ),
  ).toBe(true);
  expect(
    (
      await f.t.query(nested.betterStripe.costRecovery.queries.group, {
        groupKey: "old-invoice",
      })
    ).invoiceFunding,
  ).toBeUndefined();
  if (receipt.outcome.status !== "ready")
    throw new Error("Expected verified observation.");
  expect(
    await f.t.mutation(
      nested.betterStripe.processingCostReconciliation.steps.apply,
      {
        ...scope,
        operationId: f.request.operationId,
        version: f.request.version,
        observation: receipt.outcome.value,
      },
    ),
  ).toMatchObject({
    status: "completed",
    result: { rollbackClaim: { amountDue: 40, revision: 0 } },
  });
});
it.each(["forward", "inverse", "/v1/invoiceitems", "/v1/refunds"])(
  "holds incomplete %s before any financial write",
  async (phase) => {
    const f = await fixture();
    f.pages.set(phase, { object: "list", data: [], has_more: true });
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
it("rejects partial or ambiguous funding even when the invoice is marked paid", async () => {
  const f = await fixture();
  for (const data of [
    [{ ...f.funding, amount_paid: 500 }],
    [
      { ...f.funding, amount_paid: 500 },
      { ...f.funding, id: "inpay_other", amount_paid: 500 },
    ],
  ]) {
    f.pages.set("forward", { object: "list", data, has_more: false });
    expect(
      await f.client.observeProcessingCosts(f.ctx, f.request, {
        stripeSecretKey: "sk_test_runtime_only",
        httpClient: f.httpClient,
      }),
    ).toMatchObject({
      outcome: { status: "rejected", reason: "unsupported_source" },
    });
  }
  expect(f.writes()).toBe(0);
});
it("rejects a different original funding payment without binding or rolling back", async () => {
  const f = await fixture();
  f.pages.set("forward", {
    object: "list",
    data: [
      {
        ...f.funding,
        payment: { type: "payment_intent", payment_intent: "pi_foreign" },
      },
    ],
    has_more: false,
  });
  expect(
    await f.client.observeProcessingCosts(f.ctx, f.request, {
      stripeSecretKey: "sk_test_runtime_only",
      httpClient: f.httpClient,
    }),
  ).toMatchObject({
    outcome: { status: "conflict", reason: "identity_changed" },
  });
  expect(f.writes()).toBe(0);
});
