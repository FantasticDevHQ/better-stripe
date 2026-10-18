import { BetterStripe } from "../index.js";
import { componentsGeneric } from "convex/server";
import type { Component, RunCtx } from "../helpers.js";
import { expect, it } from "vitest";
import { fixture } from "./invoiceSale.fixtures.js";
import { getUsageInvoiceSale } from "./invoiceSale.js";
it("resolves original metered invoice funding and actual costs even after current subscription prices change", async () => {
  const f = fixture();
  expect(await getUsageInvoiceSale(f.sdk, f.input)).toMatchObject({
    status: "ready",
    value: {
      meterId: "mtr_calls",
      stripePriceId: "price_original",
      stripeProductId: "prod_original",
      invoicePaymentId: "inpay_source",
      gross: 1000,
      processingFee: 50,
      period: { start: 600, end: 1200 },
    },
  });
  expect(
    f.requests.every((r) => r.method === "GET" && r.account === "undefined"),
  ).toBe(true);
});

it("verifies included-overage cash against its original graduated price", async () => {
  const f = fixture();
  const plan = {
    ...f.input.binding.plan,
    model: "included_overage" as const,
    includedQuantity: "10",
    reset: "billing_period" as const,
  };
  Object.assign(f.price, {
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    unit_amount_decimal: null,
    tiers: [
      { up_to: 10, unit_amount_decimal: "0", flat_amount: null },
      { up_to: null, unit_amount_decimal: "2", flat_amount: null },
    ],
  });
  expect(
    await getUsageInvoiceSale(f.sdk, {
      ...f.input,
      binding: { ...f.input.binding, plan },
    }),
  ).toMatchObject({
    status: "ready",
    value: { model: "included_overage", gross: 1000 },
  });
});
it("does not recognize zero invoices, credit consumption, refunds, disputes or incomplete funding as a new sale", async () => {
  for (const condition of [
    "zero",
    "prepaid",
    "refund",
    "dispute",
    "incomplete",
    "automatic_transfer",
  ]) {
    const f = fixture();
    if (condition === "zero") f.invoice.amount_paid = 0;
    if (condition === "refund") f.payment.latest_charge.amount_refunded = 100;
    if (condition === "dispute") f.payment.latest_charge.disputed = true;
    if (condition === "incomplete")
      f.pages.set("funding:", { data: [f.funding], has_more: true });
    if (condition === "automatic_transfer")
      Object.assign(f.payment, {
        transfer_data: { destination: "acct_seller" },
      });
    const input =
      condition === "prepaid"
        ? {
            ...f.input,
            binding: {
              ...f.input.binding,
              plan: {
                ...f.input.binding.plan,
                model: "prepaid" as const,
                insufficientBalance: "reject" as const,
              },
            },
          }
        : f.input;
    expect((await getUsageInvoiceSale(f.sdk, input)).status).not.toBe("ready");
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
  }
});
it("rejects foreign original bindings, periods and mapped payer identities", async () => {
  for (const condition of [
    "realm",
    "mode",
    "payer",
    "customer",
    "meter",
    "price_meter",
    "product",
    "period",
    "item",
    "proration",
  ]) {
    const f = fixture();
    if (condition === "realm")
      f.extra.set("/v1/account", { id: "acct_foreign" });
    if (condition === "mode") f.payment.livemode = true;
    if (condition === "payer") f.invoice.customer_account = "acct_other";
    if (condition === "customer")
      Object.assign(f.payment.latest_charge, { customer: "cus_other" });
    if (condition === "meter") f.meter.id = "mtr_other";
    if (condition === "price_meter") f.price.recurring.meter = "mtr_other";
    if (condition === "product")
      f.line.pricing.price_details.product = "prod_other";
    if (condition === "period")
      Object.assign(f.line, { period: { start: 1200, end: 1800 } });
    if (condition === "item")
      f.line.parent.subscription_item_details.subscription_item = "si_other";
    if (condition === "proration")
      f.line.parent.subscription_item_details.proration = true;
    expect(
      (await getUsageInvoiceSale(f.sdk, f.input)).status,
      condition,
    ).not.toBe("ready");
  }
});

it("can settle original paid invoices after their immutable price is archived", async () => {
  const f = fixture();
  f.price.active = false;
  expect(await getUsageInvoiceSale(f.sdk, f.input)).toMatchObject({
    status: "ready",
    value: { stripePriceId: "price_original" },
  });
});

it("requires the complete original invoice-line read to retain the same item and billing period", async () => {
  for (const change of ["item", "period", "id"]) {
    const f = fixture();
    const line = structuredClone(f.line);
    if (change === "item")
      line.parent.subscription_item_details.subscription_item = "si_other";
    if (change === "period")
      Object.assign(line, { period: { start: 1200, end: 1800 } });
    if (change === "id") line.id = "il_other";
    f.extra.set("/v1/invoices/in_source/lines", {
      object: "list",
      data: [line],
      has_more: false,
    });
    expect((await getUsageInvoiceSale(f.sdk, f.input)).status, change).not.toBe(
      "ready",
    );
  }
});

it("keeps an unpaid invoice pending until native payment is verified", async () => {
  const f = fixture();
  f.invoice.status = "open";
  f.invoice.amount_paid = 0;
  expect(await getUsageInvoiceSale(f.sdk, f.input)).toEqual({
    status: "not_ready",
    reason: "provider_pending",
    retryable: true,
  });
});

it("exposes the scoped reader through stripe.usage with runtime-only credentials and the original API version", async () => {
  const f = fixture(),
    client = new BetterStripe(
      componentsGeneric().betterStripe as unknown as Component,
    );
  expect(
    await client.usage.getInvoiceSale({} as RunCtx, f.input, {
      stripeSecretKey: "sk_test_usage_sale",
      httpClient: f.httpClient,
    }),
  ).toMatchObject({ status: "ready" });
  expect(
    f.requests.every(
      (r) =>
        r.version === f.input.binding.apiVersion && r.account === "undefined",
    ),
  ).toBe(true);
});

it("verifies native graduated invoices with a zero included tier and paid overage line", async () => {
  const f = fixture();
  const plan = {
    ...f.input.binding.plan,
    model: "included_overage" as const,
    includedQuantity: "10",
    reset: "billing_period" as const,
  };
  Object.assign(f.price, {
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    unit_amount_decimal: null,
    tiers: [
      { up_to: 10, unit_amount_decimal: "0", flat_amount: null },
      { up_to: null, unit_amount_decimal: "2", flat_amount: null },
    ],
  });
  const included = {
    ...structuredClone(f.line),
    period: { ...f.input.period },
  };
  Object.assign(included, {
    id: "il_included",
    amount: 0,
    quantity_decimal: "10",
  });
  Object.assign(f.invoice, {
    lines: { data: [included, f.line], has_more: false },
  });
  f.extra.set("/v1/invoices/in_source/lines", {
    object: "list",
    data: [included, f.line],
    has_more: false,
  });
  const input = { ...f.input, binding: { ...f.input.binding, plan } };
  expect(await getUsageInvoiceSale(f.sdk, input)).toMatchObject({
    status: "ready",
    value: { model: "included_overage", gross: 1000, processingFee: 50 },
  });
  for (const mutation of [
    "foreign_item",
    "foreign_price",
    "period",
    "proration",
    "extra_paid",
    "duplicate_id",
  ]) {
    const altered = structuredClone(included);
    if (mutation === "foreign_item")
      altered.parent.subscription_item_details.subscription_item = "si_foreign";
    if (mutation === "foreign_price")
      altered.pricing.price_details.price = "price_foreign";
    if (mutation === "period") altered.period.start++;
    if (mutation === "proration")
      altered.parent.subscription_item_details.proration = true;
    if (mutation === "extra_paid") altered.amount = 1;
    if (mutation === "duplicate_id") altered.id = f.line.id;
    f.extra.set("/v1/invoices/in_source/lines", {
      object: "list",
      data: [altered, f.line],
      has_more: false,
    });
    expect((await getUsageInvoiceSale(f.sdk, input)).status, mutation).not.toBe(
      "ready",
    );
  }
});
