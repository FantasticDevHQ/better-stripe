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
