import { expect, it } from "vitest";
import { normalizeCreditState } from "./creditObservation.js";
const grant = {
  creditGrantId: "credgr_test",
  paymentIntentId: "pi_test",
  consumed: "6",
  reserved: "0",
  available: "4",
};
const terms = {
  scope: {
    stripeAccountId: "acct_platform",
    customerAccount: "acct_buyer",
    meterId: "mtr_calls",
    livemode: false,
  },
  binding: {
    apiVersion: "2026-09-30.endive" as const,
    stripeCustomerId: "cus_buyer",
    stripePriceId: "price_calls",
    eventName: "calls",
    plan: {
      key: "calls",
      version: "v1",
      model: "prepaid" as const,
      unit: { name: "call", precision: 0 },
      rate: { currency: "usd", unitAmountDecimal: "2" },
      insufficientBalance: "reject" as const,
    },
  },
  purchaseId: "topup1",
  quantity: "10",
  scaledQuantity: "10",
  amount: 20,
  ownership: "issuer" as const,
  rollover: "retain_original_terms" as const,
};
it("keeps pending native consumption separate from funded units and does not mint on invoice void", () => {
  const initial = normalizeCreditState(
    terms,
    grant,
    {
      ledgerAmount: 20,
      availableAmount: 20,
      granted: 20,
      applied: 0,
      expired: 0,
      voided: 0,
      reinstated: 0,
    },
    true,
  );
  expect(initial).toMatchObject({
    backing: "sufficient",
    pendingFinalizationAmount: 12,
    cashCollection: "none",
  });
  const applied = normalizeCreditState(
    terms,
    grant,
    {
      ledgerAmount: 8,
      availableAmount: 8,
      granted: 20,
      applied: 12,
      expired: 0,
      voided: 0,
      reinstated: 0,
    },
    true,
  );
  expect(applied).toMatchObject({
    backing: "sufficient",
    pendingFinalizationAmount: 0,
  });
  const restored = normalizeCreditState(
    terms,
    grant,
    {
      ledgerAmount: 20,
      availableAmount: 20,
      granted: 20,
      applied: 12,
      expired: 0,
      voided: 0,
      reinstated: 12,
    },
    true,
  );
  expect(restored).toMatchObject({
    backing: "held",
    reason: "invoice_void_requires_correction",
  });
});
it("holds unexpected native consumption, incomplete invoice proof and insufficient backing", () => {
  expect(
    normalizeCreditState(
      terms,
      grant,
      {
        ledgerAmount: 0,
        availableAmount: 0,
        granted: 20,
        applied: 20,
        expired: 0,
        voided: 0,
        reinstated: 0,
      },
      true,
    ).backing,
  ).toBe("held");
  expect(
    normalizeCreditState(
      terms,
      grant,
      {
        ledgerAmount: 8,
        availableAmount: 8,
        granted: 20,
        applied: 12,
        expired: 0,
        voided: 0,
        reinstated: 0,
      },
      false,
    ).backing,
  ).toBe("held");
});
