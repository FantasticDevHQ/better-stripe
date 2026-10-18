import { afterEach, expect, it, vi } from "vitest";
import { schema, modules } from "../../test.js";
import { mutation } from "../../component/_generated/server.js";
import { v } from "convex/values";
import { componentRef } from "../webhooks/helpers.js";
import { BetterStripe } from "../index.js";
import type { RunCtx } from "../helpers.js";
import { creditFixture } from "./creditTransport.fixtures.js";
afterEach(() => vi.useRealTimers());
function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
async function setup(count: number, applications = false) {
  let invoiceReads = 0;
  const entries = Array.from({ length: count }, (_, i) => ({
    id: `cbtxn_${i}`,
    object: "billing.credit_balance_transaction",
    credit_grant: "credgr_topup1",
    livemode: false,
    type: applications && i > 0 ? "debit" : "credit",
    credit:
      applications && i > 0
        ? null
        : {
            type: "credits_granted",
            amount: {
              type: "monetary",
              monetary: { currency: "usd", value: i === 0 ? 20 : 0 },
            },
          },
    debit:
      applications && i > 0
        ? {
            type: "credits_applied",
            amount: {
              type: "monetary",
              monetary: { currency: "usd", value: i <= 10 ? 2 : 0 },
            },
            credits_applied: {
              invoice: "in_usage",
              invoice_line_item: "il_usage",
            },
          }
        : null,
  }));
  const f = creditFixture(async (input) => {
    const path = new URL(input).pathname;
    if (path === "/v1/billing/credit_balance_transactions")
      return response({ object: "list", data: entries, has_more: false });
    if (path === "/v1/invoices/in_usage") {
      invoiceReads++;
      return response({
        id: "in_usage",
        livemode: false,
        customer_account: "acct_buyer",
        customer: "cus_buyer",
        currency: "usd",
        status: "paid",
        amount_paid: 0,
        status_transitions: { finalized_at: 1300 },
        parent: { subscription_details: { subscription: "sub_calls" } },
        lines: {
          has_more: false,
          data: [
            {
              id: "il_usage",
              amount: 20,
              currency: "usd",
              quantity_decimal: "10",
              period: { start: 600, end: 1200 },
              pricing: {
                price_details: { price: "price_calls" },
                unit_amount_decimal: "2",
              },
              parent: {
                subscription_item_details: {
                  subscription: "sub_calls",
                  subscription_item: "si_calls",
                  proration: false,
                },
              },
              pretax_credit_amounts: entries.slice(1).map((tx, index) => ({
                type: "credit_balance_transaction",
                credit_balance_transaction: tx.id,
                amount: index < 10 ? 2 : 0,
              })),
            },
          ],
        },
      });
    }
  });
  f.t.registerComponent("betterStripe", schema, {
    ...modules,
    "./component/proofBoundsFixture.ts": async () => ({
      pinProvider: mutation({
        args: {},
        returns: v.null(),
        handler: async (ctx) => {
          const outbox = (await ctx.db.query("usageOutbox").first())!;
          await ctx.db.patch(outbox._id, {
            provider: "function://test-provider",
            definitionVersion: 1,
          });
          return null;
        },
      }),
    }),
  });
  const client = new BetterStripe(f.component),
    provider = { stripeSecretKey: "sk_test_credit", httpClient: f.httpClient };
  const view = await f.ready();
  await f.t.action((ctx) =>
    client.usage.purchaseCredits(ctx as RunCtx, f.purchase, provider),
  );
  f.state.paid = true;
  await f.t.action((ctx) =>
    client.usage.observeCreditPurchase(ctx as RunCtx, f.purchase, provider),
  );
  if (applications) {
    const event = {
        scope: f.purchase.scope,
        binding: f.purchase.binding,
        sourceEventId: "all_units",
        quantity: "10",
        occurredAt: 700,
      },
      subscription = view.bindings[0].subscription;
    const reservation = await f.t.action((ctx) =>
      client.usage.reserveCredits(ctx as RunCtx, { event, subscription }),
    );
    const receipt = await f.t.action((ctx) =>
      client.usage.record(ctx as RunCtx, {
        event,
        subscription,
        reservationId: reservation.reservationId,
      }),
    );
    await f.t.action(async (ctx) => {
      await ctx.runMutation(
        componentRef(f.component, "proofBoundsFixture/pinProvider"),
        {},
      );
      const claimed = (await ctx.runMutation(
        componentRef(f.component, "usageDelivery/steps/claim"),
        { scope: event.scope, eventId: receipt.eventId },
      )) as { kind: string; request: Record<string, unknown> };
      expect(claimed.kind).toBe("ready");
      await ctx.runMutation(
        componentRef(f.component, "usageDelivery/steps/save"),
        { ...claimed.request, outcome: { status: "accepted", created: 700 } },
      );
    });
    f.state.nativeApplied = 20;
  }
  const reconcile = () =>
    f.t.action((ctx) =>
      client.usage.reconcileCreditPurchase(ctx as RunCtx, f.purchase, provider),
    );
  return { f, reconcile, invoiceReads: () => invoiceReads };
}
it("accepts exactly 100 native credit transactions and rejects an oversized transaction proof", async () => {
  expect(await (await setup(100)).reconcile()).toMatchObject({
    status: "available",
    value: { backing: "sufficient" },
  });
  await expect((await setup(101)).reconcile()).rejects.toThrow(
    /budget|limit|unavailable/i,
  );
});
it("proves ten original credit-funded invoice applications and holds an eleventh without guessing", async () => {
  const exact = await setup(11, true);
  const observed = await exact.reconcile();
  expect(observed).toMatchObject({
    status: "available",
    value: { reason: null, backing: "sufficient", applied: 20 },
  });
  expect(exact.invoiceReads()).toBe(10);
  const overflow = await setup(12, true);
  expect(await overflow.reconcile()).toMatchObject({
    status: "available",
    value: { backing: "held", reason: "invoice_provenance_unavailable" },
  });
  expect(overflow.invoiceReads()).toBe(0);
});
