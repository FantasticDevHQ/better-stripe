import Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it, vi } from "vitest";
import { CostRecoveryClient, type RecoveryGroup } from "./costRecovery.js";
import type { Component, RunCtx } from "./helpers.js";

const scope = {
  accountId: "acct_owner",
  scopeKey: "store",
  currency: "usd",
  groupKey: "invoice:in_1",
};
async function fixture(mode: string) {
  const group = {
    ...scope,
    _id: "group_1",
    _creationTime: 0,
    sourceKind: "invoice",
    sourceId: "in_1",
    status: "collecting",
    amount: 11,
    pendingOperations: 10,
    maxDebit: 1000,
    maxCredit: 1000,
    invoiceItemId: "ii_original",
  } as RecoveryGroup;
  const requests: { method: string; url: string }[] = [];
  const sdk = new Stripe("sk_test_receipt_fixture", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(url) });
      const path = new URL(String(url));
      const item = {
        id: mode === "identity" ? "ii_foreign" : "ii_original",
        object: "invoiceitem",
        invoice: "in_1",
        customer_account: "acct_owner",
        currency: "usd",
        amount: mode === "amount" ? 12 : 11,
        discountable: false,
        metadata: { bsRecoveryGroup: "group_1" },
      };
      const data = path.pathname.startsWith("/v1/invoices/")
        ? {
            id: "in_1",
            object: "invoice",
            customer_account: "acct_owner",
            currency: "usd",
            status: mode === "pending" ? "open" : "paid",
          }
        : {
            object: "list",
            has_more: mode === "incomplete",
            data:
              mode === "incomplete"
                ? Array.from({ length: 100 }, (_, i) => ({
                    id: `ii_${requests.length}_${i}`,
                    metadata: {},
                  }))
                : mode === "duplicate"
                  ? [item, { ...item, id: "ii_duplicate" }]
                  : [item],
          };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  });
  const runMutation = vi.fn(() => {
    throw new Error("Verifier must not mutate");
  });
  const ctx = { runQuery: async () => group, runMutation } as unknown as RunCtx;
  const client = new CostRecoveryClient(
    componentsGeneric().betterStripe as unknown as Component,
    () => sdk,
  );
  return { client, ctx, requests, runMutation, group };
}
it("verifies an exact terminal invoice receipt with GETs only and no ledger or binding writes", async () => {
  const f = await fixture("ready");
  expect(await f.client.verifyInvoiceReceipt(f.ctx, scope)).toMatchObject({
    status: "ready",
    outcome: "collect",
    invoiceItemId: "ii_original",
    invoiceStatus: "paid",
    group: { status: "collecting", amount: 11 },
  });
  expect(f.runMutation).not.toHaveBeenCalled();
  expect(f.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
});
it.each(["identity", "amount", "duplicate", "incomplete", "pending"])(
  "fails closed for %s receipts without writes",
  async (mode) => {
    const f = await fixture(mode);
    expect(await f.client.verifyInvoiceReceipt(f.ctx, scope)).toMatchObject({
      status: "unknown",
      reason: "history_incomplete",
      retryable: false,
    });
    expect(f.runMutation).not.toHaveBeenCalled();
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
    expect(f.requests.length).toBeLessThanOrEqual(6);
  },
);
it("rejects an unauthorized scope before provider I/O", async () => {
  const f = await fixture("ready");
  expect(
    await f.client.verifyInvoiceReceipt(f.ctx, {
      ...scope,
      accountId: "acct_other",
    }),
  ).toMatchObject({ status: "unknown" });
  expect(f.requests).toHaveLength(0);
});
