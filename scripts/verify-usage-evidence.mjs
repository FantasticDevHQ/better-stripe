import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
/** Audit retained proof, never contact Stripe or classify an unavailable observation as zero. */
export function verifyUsageEvidence(original, fresh) {
  let count = 0;
  for (const role of ["customer", "seller"]) {
    for (const model of ["pay_as_you_go", "included_overage", "prepaid"]) {
      const current = fresh.models[`${role}:${model}`];
      assert.equal(current.observe.status, "available");
      assert.equal(current.observe.value.complete, true);
      assert.equal(current.observe.value.stale, false);
      assert.equal(current.snapshot.summary.status, "available");
      const local = current.snapshot.summary.value;
      assert.equal(local.complete, true);
      assert.equal(local.groups.length, 1);
      const group = local.groups[0];
      assert.equal(group.binding.plan.model, model);
      assert.equal(
        group.effectiveScaledQuantity,
        current.observe.value.scaledQuantity,
      );
      assert.equal(
        group.providerAcceptedScaledQuantity,
        group.effectiveScaledQuantity,
      );
      assert.equal(current.history.status, "available");
      const history = current.history.value;
      assert.equal(history.isDone, true);
      assert.equal(history.complete, true);
      const records = history.records;
      assert.equal(
        new Set(records.map((row) => row.record.identity)).size,
        records.length,
      );
      assert.equal(records.length, local.eventCount);
      const scope = records[0].record.scope;
      let effective = 0n;
      for (const row of records) {
        assert.equal(row.record.scope.livemode, false);
        assert.deepEqual(row.record.scope, scope);
        assert.equal(
          row.record.binding.stripePriceId,
          group.binding.stripePriceId,
        );
        assert.deepEqual(row.subscription.period, local.period);
        assert.ok(["provider_accepted", "canceled"].includes(row.delivery));
        if (row.delivery !== "canceled")
          effective += BigInt(row.record.scaledQuantity);
      }
      assert.equal(effective.toString(), group.effectiveScaledQuantity);
      const billing =
        role === "customer"
          ? original.customerModels[model].billing
          : original.sellerModels[model];
      assert.equal(billing.status, "paid");
      assert.equal(billing.currency, "usd");
      assert.equal(billing.invoice.length, 1);
      const invoice = billing.invoice[0].observation;
      assert.equal(invoice.status, "available");
      assert.equal(invoice.value.invoiceId, billing.invoiceId);
      assert.equal(invoice.value.finalized, true);
      assert.equal(invoice.value.linesComplete, true);
      assert.equal(invoice.value.meterAmount.status, "available");
      let units = 0n;
      for (const line of invoice.value.lines) {
        assert.equal(line.stripePriceId, group.binding.stripePriceId);
        assert.equal(
          line.subscriptionItemId,
          group.subscription.subscriptionItemId,
        );
        assert.deepEqual(line.nativePeriod, local.period);
        assert.equal(line.proration, false);
        units += BigInt(line.quantity);
      }
      assert.equal(units.toString(), group.effectiveQuantity);
      assert.equal(
        billing.amountPaid,
        model === "pay_as_you_go"
          ? 1500
          : model === "included_overage"
            ? 500
            : 0,
      );
      assert.equal(billing.revenue.length, 1);
      const { cash, settlement } = billing.revenue[0];
      assert.equal(cash.status, "ready");
      assert.equal(cash.value.livemode, false);
      assert.equal(cash.value.stripeAccountId, scope.stripeAccountId);
      assert.equal(
        cash.value.customerAccount ?? cash.value.customerAccountId,
        scope.customerAccount,
      );
      assert.equal(cash.value.stripePriceId, group.binding.stripePriceId);
      assert.equal(
        cash.value.gross,
        model === "prepaid" ? 1000 : billing.amountPaid,
      );
      assert.equal(
        cash.value.processingFee,
        model === "pay_as_you_go" ? 74 : model === "included_overage" ? 45 : 59,
      );
      if (model !== "prepaid")
        assert.equal(cash.value.invoiceId, billing.invoiceId);
      else {
        assert.equal(
          current.snapshot.purchase.paymentIntentId,
          cash.value.paymentIntentId,
        );
        assert.equal(
          current.snapshot.purchase.creditGrantId,
          cash.value.creditGrantId,
        );
        assert.equal(current.snapshot.creditApplication.status, "available");
        assert.equal(
          current.snapshot.creditApplication.value.backing,
          "sufficient",
        );
        assert.equal(current.snapshot.creditApplication.value.granted, 1000);
        assert.equal(current.snapshot.creditApplication.value.applied, 1000);
        assert.equal(
          current.snapshot.creditApplication.value.availableAmount,
          0,
        );
        assert.equal(
          current.snapshot.creditApplication.value.pendingFinalizationAmount,
          0,
        );
        assert.equal(current.snapshot.credits.status, "available");
        assert.equal(current.snapshot.credits.value.consumedQuantity, "10");
        assert.equal(current.snapshot.credits.value.availableQuantity, "0");
        assert.equal(current.snapshot.credits.value.cashCollection, "none");
      }
      if (role === "seller") {
        assert.equal(settlement.status, "settled");
        assert.equal(settlement.sourceChargeId, cash.value.chargeId);
        assert.equal(settlement.paymentIntentId, cash.value.paymentIntentId);
        assert.equal(
          new Set(
            settlement.executedTransfers.map((row) => row.stripeTransferId),
          ).size,
          settlement.executedTransfers.length,
        );
        assert.equal(
          settlement.processingFee +
            settlement.platformNet +
            settlement.executedTransfers.reduce(
              (sum, row) => sum + row.amount,
              0,
            ),
          cash.value.gross,
        );
        if (model === "prepaid")
          assert.deepEqual(
            settlement.executedTransfers.map((row) => row.role),
            ["affiliate"],
          );
      }
      assert.equal(billing.renewal.allowance, null);
      assert.equal(billing.renewal.allowanceStatus, "not_active_yet");
      count++;
    }
  }
  return {
    models: count,
    tolerance: "0 scaled units",
    cash: "original paid source only",
    renewal: "future allowance unavailable",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const original = JSON.parse(
    readFileSync("docs/evidence/usage-example/native-results.json", "utf8"),
  );
  const fresh = JSON.parse(
    readFileSync(
      "docs/evidence/usage-verification/native-refresh.json",
      "utf8",
    ),
  );
  console.log(JSON.stringify(verifyUsageEvidence(original, fresh)));
}
