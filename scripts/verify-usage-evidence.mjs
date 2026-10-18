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
      assert.deepEqual(current.observe.value.period, local.period);
      assert.equal(current.observe.value.nextCursor, null);
      assert.equal(local.groups.length, 1);
      const group = local.groups[0];
      assert.equal(group.binding.plan.model, model);
      assert.equal(group.binding.plan.unit.precision, 0);
      assert.equal(
        current.observe.value.quantity,
        current.observe.value.scaledQuantity,
      );
      assert.equal(
        current.observe.value.entries
          .reduce((sum, row) => sum + BigInt(row.scaledQuantity), 0n)
          .toString(),
        current.observe.value.scaledQuantity,
      );
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
        assert.deepEqual(row.record.binding, group.binding);
        assert.deepEqual(row.subscription, group.subscription);
        const identity = JSON.stringify([
          scope.livemode,
          scope.stripeAccountId,
          scope.customerAccount,
          scope.meterId,
          row.record.sourceEventId,
        ]);
        assert.equal(row.record.identity, identity);
        assert.equal(row.receipt.identity, identity);
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
      assert.equal(billing.invoice[0].meterId, scope.meterId);
      assert.equal(
        billing.invoice[0].subscriptionItemId,
        group.subscription.subscriptionItemId,
      );
      const invoice = billing.invoice[0].observation;
      assert.equal(invoice.status, "available");
      assert.equal(invoice.value.invoiceId, billing.invoiceId);
      assert.equal(invoice.value.finalized, true);
      assert.equal(invoice.value.status, "paid");
      assert.equal(invoice.value.currency, billing.currency);
      assert.equal(invoice.value.amountDue, String(billing.amountDue));
      assert.equal(invoice.value.amountPaid, String(billing.amountPaid));
      assert.equal(invoice.value.linesComplete, true);
      assert.equal(invoice.value.meterAmount.status, "available");
      assert.equal(invoice.value.meterAmount.value.currency, billing.currency);
      let units = 0n;
      let rated = 0n;
      let applied = 0n;
      for (const line of invoice.value.lines) {
        assert.equal(line.stripePriceId, group.binding.stripePriceId);
        assert.equal(
          line.subscriptionItemId,
          group.subscription.subscriptionItemId,
        );
        assert.deepEqual(line.nativePeriod, local.period);
        assert.equal(line.proration, false);
        assert.equal(line.currency, billing.currency);
        rated += BigInt(line.amount);
        applied += BigInt(line.creditAppliedAmount);
        units += BigInt(line.quantity);
      }
      assert.equal(units.toString(), group.effectiveQuantity);
      const expectedRated =
        model === "pay_as_you_go"
          ? 1500n
          : model === "included_overage"
            ? 500n
            : 1000n;
      assert.equal(rated, expectedRated);
      assert.equal(invoice.value.meterAmount.value.amount, rated.toString());
      assert.equal(applied, model === "prepaid" ? 1000n : 0n);
      assert.equal(rated - applied, BigInt(billing.amountDue));
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
      assert.equal(cash.value.currency, billing.currency);
      assert.equal(cash.value.currency, group.binding.plan.rate.currency);
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
      if (model !== "prepaid") {
        assert.equal(cash.value.invoiceId, billing.invoiceId);
        assert.equal(cash.value.meterId, scope.meterId);
        assert.equal(cash.value.model, model);
        assert.deepEqual(cash.value.period, local.period);
        assert.equal(
          cash.value.subscriptionId,
          group.subscription.subscriptionId,
        );
        assert.equal(
          cash.value.subscriptionItemId,
          group.subscription.subscriptionItemId,
        );
      } else {
        assert.equal(current.snapshot.purchase.state, "ready");
        assert.equal(
          current.snapshot.purchase.purchaseId,
          cash.value.purchaseId,
        );
        assert.equal(current.snapshot.purchase.quantity, "10");
        assert.equal(current.snapshot.purchase.amount, cash.value.gross);
        assert.equal(current.snapshot.purchase.currency, cash.value.currency);
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
      if (role === "customer" && model !== "prepaid")
        assert.equal(settlement, null);
      else {
        assert.equal(settlement.status, "settled");
        assert.equal(settlement.sourceChargeId, cash.value.chargeId);
        assert.equal(settlement.paymentIntentId, cash.value.paymentIntentId);
        assert.equal(settlement.gross, cash.value.gross);
        assert.equal(settlement.currency, cash.value.currency);
        assert.equal(settlement.processingFee, cash.value.processingFee);
        const shared = {
          customerAccount: scope.customerAccount,
          livemode: scope.livemode,
          stripeAccountId: scope.stripeAccountId,
          stripePriceId: group.binding.stripePriceId,
          stripeProductId: cash.value.stripeProductId,
        };
        if (model === "prepaid") {
          assert.deepEqual(settlement.creditSource, {
            ...shared,
            creditGrantId: cash.value.creditGrantId,
            purchaseId: cash.value.purchaseId,
          });
          assert.equal(settlement.sourceInvoiceId, undefined);
        } else {
          assert.equal(settlement.sourceInvoiceId, billing.invoiceId);
          assert.deepEqual(settlement.usageSource, {
            ...shared,
            invoicePaymentId: cash.value.invoicePaymentId,
            meterId: scope.meterId,
            model,
            period: local.period,
            subscriptionId: group.subscription.subscriptionId,
            subscriptionItemId: group.subscription.subscriptionItemId,
          });
        }
        const executed = settlement.executedTransfers.map(
          ({ amount, destinationAccountId, role }) => ({
            amount,
            destinationAccountId,
            role,
          }),
        );
        assert.deepEqual(executed, settlement.transfers);
        const expected =
          role === "customer"
            ? []
            : model === "pay_as_you_go"
              ? [
                  ["store", 1080],
                  ["affiliate", 270],
                ]
              : model === "included_overage"
                ? [
                    ["store", 360],
                    ["affiliate", 90],
                  ]
                : [["affiliate", 180]];
        assert.deepEqual(
          executed.map(({ role, amount }) => [role, amount]),
          expected,
        );
        assert.equal(
          new Set(
            settlement.executedTransfers.map((row) => row.stripeTransferId),
          ).size,
          settlement.executedTransfers.length,
        );
        assert.equal(
          settlement.processingFee +
            settlement.platformNet +
            executed.reduce((sum, row) => sum + row.amount, 0),
          cash.value.gross,
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
