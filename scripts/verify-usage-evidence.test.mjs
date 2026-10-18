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
it.each(
  ["pay_as_you_go", "included_overage", "prepaid"].flatMap((model) =>
    [
      "balanced_fee",
      "gross",
      "currency",
      "recipient",
      "role",
      "planned_amount",
      "source_customer",
      "source_price",
      "source_variant",
    ].map((failure) => [model, failure]),
  ),
)("rejects %s settlement with contradictory %s", (model, failure) => {
  const [original, fresh] = proof();
  const settlement = original.sellerModels[model].revenue[0].settlement;
  const source = settlement.usageSource ?? settlement.creditSource;
  if (failure === "balanced_fee") {
    settlement.processingFee++;
    settlement.platformNet--;
  }
  if (failure === "gross") settlement.gross++;
  if (failure === "currency") settlement.currency = "eur";
  if (failure === "recipient")
    settlement.executedTransfers[0].destinationAccountId = "acct_foreign";
  if (failure === "role") settlement.executedTransfers[0].role = "reseller";
  if (failure === "planned_amount") settlement.transfers[0].amount++;
  if (failure === "source_customer") source.customerAccount = "acct_foreign";
  if (failure === "source_price") source.stripePriceId = "price_foreign";
  if (failure === "source_variant") {
    if (model === "prepaid") source.creditGrantId = "credgr_foreign";
    else source.period = { start: 1, end: 2 };
  }
  expect(() => verifyUsageEvidence(original, fresh)).toThrow();
});
it.each(
  ["pay_as_you_go", "included_overage", "prepaid"].flatMap((model) =>
    [
      "native_quantity",
      "native_entries",
      "invoice_meter",
      "invoice_item",
      "history_binding",
      "history_subscription",
      "record_identity",
      "receipt_identity",
      "cash_currency",
    ].map((failure) => [model, failure]),
  ),
)("rejects %s with inconsistent %s", (model, failure) => {
  const [original, fresh] = proof();
  const current = fresh.models[`seller:${model}`];
  const billing = original.sellerModels[model];
  if (failure === "native_quantity") current.observe.value.quantity = "999";
  if (failure === "native_entries")
    current.observe.value.entries[0].scaledQuantity = "999";
  if (failure === "invoice_meter") billing.invoice[0].meterId = "mtr_foreign";
  if (failure === "invoice_item")
    billing.invoice[0].subscriptionItemId = "si_foreign";
  if (failure === "history_binding")
    current.history.value.records[0].record.binding.stripeCustomerId =
      "cus_foreign";
  if (failure === "history_subscription")
    current.history.value.records[0].subscription.subscriptionId =
      "sub_foreign";
  if (failure === "record_identity")
    current.history.value.records[0].record.identity = "foreign";
  if (failure === "receipt_identity")
    current.history.value.records[0].receipt.identity = "foreign";
  if (failure === "cash_currency")
    billing.revenue[0].cash.value.currency = "eur";
  expect(() => verifyUsageEvidence(original, fresh)).toThrow();
});
it.each(["state", "purchaseId", "amount", "currency", "quantity"])(
  "rejects original prepaid purchase %s mismatch",
  (field) => {
    const [original, fresh] = proof();
    fresh.models["seller:prepaid"].snapshot.purchase[field] =
      field === "amount" ? 999 : "foreign";
    expect(() => verifyUsageEvidence(original, fresh)).toThrow();
  },
);
it("does not ignore customer prepaid settlement contradictions", () => {
  const [original, fresh] = proof();
  const settlement =
    original.customerModels.prepaid.billing.revenue[0].settlement;
  settlement.processingFee++;
  settlement.platformNet--;
  expect(() => verifyUsageEvidence(original, fresh)).toThrow();
});
