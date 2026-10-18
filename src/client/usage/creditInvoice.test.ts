import Stripe from "stripe";
import { componentsGeneric } from "convex/server";
import { expect, it } from "vitest";
import { verifyCreditInvoice } from "./creditInvoice.js";
import { creditPurchaseTerms } from "./creditTerms.js";
import type { Component, RunCtx } from "../helpers.js";
const terms = creditPurchaseTerms({
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  binding: {
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "prepaid",
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
      insufficientBalance: "reject",
    },
  },
  purchaseId: "topup1",
  quantity: "10",
  ownership: "issuer",
  rollover: "retain_original_terms",
});
function fixture() {
  const native = {
    id: "in_usage",
    livemode: false,
    customer_account: "acct_buyer",
    customer: "cus_buyer",
    currency: "usd",
    status: "paid",
    amount_paid: 0,
    amount_due: 0,
    status_transitions: { finalized_at: 1300 },
    parent: { subscription_details: { subscription: "sub_original" } },
    lines: {
      has_more: false,
      data: [
        {
          id: "il_usage",
          amount: 12,
          currency: "usd",
          quantity_decimal: "6",
          period: { start: 600, end: 1200 },
          pricing: {
            price_details: { price: "price_calls" },
            unit_amount_decimal: "2",
          },
          parent: {
            subscription_item_details: {
              subscription: "sub_original",
              subscription_item: "si_original",
              proration: false,
            },
          },
          pretax_credit_amounts: [
            {
              type: "credit_balance_transaction",
              credit_balance_transaction: "cbtxn_applied",
              amount: 12,
            },
          ],
        },
      ],
    },
  };
  const stripe = new Stripe("sk_test_credit_invoice", {
    httpClient: Stripe.createFetchHttpClient(
      async () =>
        new Response(JSON.stringify(native), {
          headers: { "content-type": "application/json" },
        }),
    ),
  });
  const requests: unknown[] = [],
    local = { complete: true, valid: true, scaledQuantity: "6" };
  const ctx = {
    runQuery: async (_reference: unknown, args: unknown) => {
      requests.push(args);
      return local;
    },
  } as unknown as RunCtx;
  const tx = {
    id: "cbtxn_applied",
    debit: {
      type: "credits_applied",
      amount: { type: "monetary", monetary: { currency: "usd", value: 12 } },
      credits_applied: { invoice: "in_usage", invoice_line_item: "il_usage" },
    },
  } as unknown as Stripe.Billing.CreditBalanceTransaction;
  const component = componentsGeneric().betterStripe as unknown as Component;
  const read = () => verifyCreditInvoice(stripe, component, ctx, terms, tx);
  return { native, stripe, requests, local, tx, read };
}
it("proves a fully credit-funded original invoice line without treating paid as new cash", async () => {
  const f = fixture();
  expect(await f.read()).toBe(true);
  expect(f.requests).toMatchObject([
    {
      subscriptionId: "sub_original",
      subscriptionItemId: "si_original",
      start: 600,
      end: 1200,
    },
  ]);
});
it("refuses foreign payer, changed price, truncated lines, proration and changed credit provenance", async () => {
  const foreign = fixture();
  foreign.native.customer_account = "acct_other";
  expect(await foreign.read()).toBe(false);
  const changed = fixture();
  changed.native.lines.data[0].pricing.price_details.price = "price_new";
  expect(await changed.read()).toBe(false);
  const partial = fixture();
  partial.native.lines.has_more = true;
  expect(await partial.read()).toBe(false);
  const prorated = fixture();
  prorated.native.lines.data[0].parent.subscription_item_details.proration = true;
  expect(await prorated.read()).toBe(false);
  const other = fixture();
  other.native.lines.data[0].pretax_credit_amounts[0].credit_balance_transaction =
    "cbtxn_other";
  expect(await other.read()).toBe(false);
});
it("requires exact complete local quantities and successful native delivery", async () => {
  for (const local of [
    { complete: false, valid: true, scaledQuantity: "6" },
    { complete: true, valid: false, scaledQuantity: "6" },
    { complete: true, valid: true, scaledQuantity: "7" },
  ]) {
    const f = fixture();
    Object.assign(f.local, local);
    expect(await f.read()).toBe(false);
  }
  const fractional = fixture();
  fractional.native.lines.data[0].quantity_decimal = "6.1";
  expect(await fractional.read()).toBe(false);
  const extraCharge = fixture();
  extraCharge.native.lines.data[0].pretax_credit_amounts[0].amount = 10;
  expect(await extraCharge.read()).toBe(false);
});
