import type { AffiliateRecoverySnapshot } from "../client/affiliateRecovery.js";
export type AffiliateRecoveryScenario = {
  id: string;
  label: string;
  evidence: "simulated";
  snapshot: AffiliateRecoverySnapshot;
};
/** Presentation fixtures only. These IDs are not Stripe or bank-payout receipts. */
export function affiliateRecoveryScenarios(): AffiliateRecoveryScenario[] {
  const cases = [
    {
      id: "one-time-refund",
      label: "One-time full refund",
      finalized: 1001,
      recovered: 1001,
    },
    {
      id: "invoice-refund",
      label: "Recurring invoice refund",
      finalized: 1001,
      recovered: 1001,
      invoice: "fixture_invoice_renewal",
    },
    {
      id: "partial-refund",
      label: "Partial refund and rounding",
      finalized: 501,
      recovered: 501,
    },
    {
      id: "open-dispute",
      label: "Open monetary dispute",
      finalized: 0,
      provisional: 1001,
      recovered: 1001,
    },
    {
      id: "lost-dispute",
      label: "Lost dispute finalized",
      finalized: 1001,
      recovered: 1001,
    },
    {
      id: "won-dispute",
      label: "Won dispute restored",
      finalized: 0,
      recovered: 1001,
      restored: 1001,
    },
    {
      id: "overlap",
      label: "Refund retained after dispute win",
      finalized: 501,
      recovered: 1001,
      restored: 500,
    },
    {
      id: "paid-out",
      label: "Insufficient balance after external payout",
      finalized: 1001,
      recovered: 0,
      state: "insufficient_balance",
    },
    {
      id: "future-offset",
      label: "Debt recovered from future commission",
      finalized: 1001,
      recovered: 0,
      offset: 1001,
    },
    {
      id: "unknown",
      label: "Provider timeout awaiting receipt",
      finalized: 1001,
      recovered: 0,
      reserved: 1001,
      state: "unknown",
    },
  ];
  return cases.map((c) => {
    const recoveredAmount = c.recovered,
      offsetAmount = c.offset ?? 0,
      restoredAmount = c.restored ?? 0;
    const debt = Math.max(
      0,
      c.finalized +
        (c.provisional ?? 0) -
        recoveredAmount -
        offsetAmount +
        restoredAmount,
    );
    const row = {
      _id: `fixture_${c.id}`,
      _creationTime: 0,
      sourceChargeId: `fixture_charge_${c.id}`,
      sourceInvoiceId: c.invoice,
      paymentIntentId: "fixture_payment",
      affiliateAccountId: "fixture_affiliate",
      currency: "usd",
      chargeAmount: 10000,
      originalCommission: 1001,
      refundedPrincipal: c.finalized ? 10000 : 0,
      disputedPrincipal: c.provisional ? 10000 : 0,
      lostPrincipal: 0,
      finalizedAmount: c.finalized,
      provisionalAmount: c.provisional ?? 0,
      recoveredAmount,
      offsetAmount,
      restoredAmount,
      reservedRecovery: c.reserved ?? 0,
      debtAmount: debt,
      creditAmount: 0,
      needsReconciliation: false,
      lastState: c.state ?? "succeeded",
    } as AffiliateRecoverySnapshot["obligations"]["page"][number];
    const snapshot = {
      balance: {
        _id: `fixture_balance_${c.id}`,
        _creationTime: 0,
        affiliateAccountId: "fixture_affiliate",
        currency: "usd",
        originalCommission: 1001,
        recoveredAmount,
        offsetAmount,
        restoredAmount,
        outstandingDebt: debt,
        reservedRecovery: c.reserved ?? 0,
        reservedRestoration: 0,
        restorationDue: 0,
        withheldAmount: offsetAmount,
        netPayable: 0,
      },
      obligations: { page: [row], continueCursor: "", isDone: true },
    } as AffiliateRecoverySnapshot;
    return { id: c.id, label: c.label, evidence: "simulated", snapshot };
  });
}
