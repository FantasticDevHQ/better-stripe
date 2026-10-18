import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { verifyUsageEvidence } from "./verify-usage-evidence.mjs";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
function proof() {
  return [
    read("docs/evidence/usage-example/native-results.json"),
    read("docs/evidence/usage-verification/native-refresh.json"),
  ];
}
it("compares exact six-model native aggregates, original invoices and paid-source economics", () => {
  expect(verifyUsageEvidence(...proof())).toMatchObject({
    models: 6,
    tolerance: "0 scaled units",
  });
});
it.each([
  "unknown",
  "stale",
  "partial",
  "quantity",
  "price",
  "cash",
  "transfer",
])(
  "rejects %s proof without replacing it with a successful zero",
  (failure) => {
    const [original, fresh] = proof();
    const current = fresh.models["seller:pay_as_you_go"];
    if (failure === "unknown") current.observe = { status: "unavailable" };
    if (failure === "stale") current.observe.value.stale = true;
    if (failure === "partial") current.history.value.isDone = false;
    if (failure === "quantity") current.observe.value.scaledQuantity = "0";
    if (failure === "price")
      current.snapshot.summary.value.groups[0].binding.stripePriceId =
        "price_foreign";
    if (failure === "cash")
      original.sellerModels.pay_as_you_go.revenue[0].cash.value.chargeId =
        "ch_foreign";
    if (failure === "transfer")
      original.sellerModels.pay_as_you_go.revenue[0].settlement.executedTransfers.push(
        original.sellerModels.pay_as_you_go.revenue[0].settlement
          .executedTransfers[0],
      );
    expect(() => verifyUsageEvidence(original, fresh)).toThrow();
  },
);
it.each(
  ["pay_as_you_go", "included_overage", "prepaid"].flatMap((model) =>
    [
      "native_period",
      "rated_amount",
      "rated_currency",
      "invoice_currency",
      "line_currency",
      "line_amount",
      "invoice_status",
    ].map((failure) => [model, failure]),
  ),
)("rejects %s with corrupted %s", (model, failure) => {
  const [original, fresh] = proof();
  const current = fresh.models[`seller:${model}`];
  const invoice = original.sellerModels[model].invoice[0].observation.value;
  if (failure === "native_period")
    current.observe.value.period = { start: 1, end: 2 };
  if (failure === "rated_amount") invoice.meterAmount.value.amount = "999999";
  if (failure === "rated_currency") invoice.meterAmount.value.currency = "eur";
  if (failure === "invoice_currency") invoice.currency = "eur";
  if (failure === "line_currency") invoice.lines[0].currency = "eur";
  if (failure === "line_amount") invoice.lines[0].amount = "999999";
  if (failure === "invoice_status") invoice.status = "open";
  expect(() => verifyUsageEvidence(original, fresh)).toThrow();
});
it("cannot claim a paid prepaid invoice consumed its original credits after the application proof changes", () => {
  const [original, fresh] = proof();
  original.sellerModels.prepaid.invoice[0].observation.value.lines[0].creditAppliedAmount =
    "0";
  expect(() => verifyUsageEvidence(original, fresh)).toThrow();
});
