import { expect, it } from "vitest";
import { mixed } from "./mixedInvoice.fixtures.js";
import { getUsageInvoiceSale } from "./invoiceSale.js";

it("settles the complete mixed invoice with advance base and arrears usage, using one actual fee", async () => {
  const f = mixed();
  expect(await getUsageInvoiceSale(f.sdk, f.input)).toMatchObject({
    status: "ready",
    value: {
      gross: 3000,
      processingFee: 120,
      invoiceLines: [
        { lineId: "il_base", period: { start: 1200, end: 1800 }, amount: 2000 },
        {
          lineId: "il_source",
          period: { start: 600, end: 1200 },
          amount: 1000,
        },
      ],
    },
  });
});
it("recognizes initial base-only cash and paginates full invoice lines", async () => {
  const f = mixed();
  Object.assign(f.line, { amount: 0, quantity_decimal: "0" });
  Object.assign(f.invoice, { billing_reason: "subscription_create" });
  f.base.amount = 3000;
  const basePrice = f.extra.get("/v1/prices/price_base") as Record<
    string,
    unknown
  >;
  Object.assign(basePrice, { unit_amount: 3000, unit_amount_decimal: "3000" });
  f.pages.set("lines:", { data: [f.base], has_more: true });
  f.pages.set("lines:il_base", { data: [f.line], has_more: false });
  expect(
    await getUsageInvoiceSale(f.sdk, {
      ...f.input,
      fixedPrice: { ...f.input.fixedPrice, unitAmount: 3000 },
    }),
  ).toMatchObject({ status: "ready", value: { gross: 3000 } });
});
it("holds foreign, duplicate, discounted, taxed, credited or prorated lines without transferring", async () => {
  for (const change of [
    "product",
    "item",
    "extra",
    "discount",
    "tax",
    "credit",
    "proration",
    "amount",
    "duplicate",
  ]) {
    const f = mixed();
    if (change === "product")
      f.base.pricing.price_details.product = "prod_foreign";
    if (change === "item")
      f.base.parent.subscription_item_details.subscription_item = "si_foreign";
    if (change === "extra")
      f.history.lines.push({ ...f.base, id: "il_foreign" });
    if (change === "discount")
      Object.assign(f.base, { discount_amounts: [{ amount: 1 }] });
    if (change === "tax")
      Object.assign(f.invoice, { total_taxes: [{ amount: 1 }] });
    if (change === "credit")
      Object.assign(f.base, { pretax_credit_amounts: [{ amount: 1 }] });
    if (change === "proration")
      f.base.parent.subscription_item_details.proration = true;
    if (change === "amount") f.base.amount--;
    if (change === "duplicate") f.base.id = f.line.id;
    expect((await getUsageInvoiceSale(f.sdk, f.input)).status, change).not.toBe(
      "ready",
    );
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
  }
});
