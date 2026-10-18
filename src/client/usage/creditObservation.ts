import { creditCost, type UsageCreditPurchaseTerms } from "./creditTerms.js";
export type UsageCreditNativeAmounts = {
  ledgerAmount: number;
  availableAmount: number;
  granted: number;
  applied: number;
  expired: number;
  voided: number;
  reinstated: number;
};
export type UsageCreditReconciliation = UsageCreditNativeAmounts & {
  backing: "sufficient" | "held";
  reason: string | null;
  pendingFinalizationAmount: number;
  cashCollection: "none";
  invoicePaymentEvidence: "not_resolved";
};
export function normalizeCreditState(
  terms: UsageCreditPurchaseTerms,
  grant: { consumed: string; reserved: string; available: string },
  native: UsageCreditNativeAmounts,
  invoicesVerified: boolean,
): UsageCreditReconciliation {
  const cost = (quantity: string) =>
    BigInt(quantity) === 0n ? 0 : creditCost(terms.binding.plan, quantity);
  const consumed = cost(grant.consumed),
    reserved = cost(grant.reserved),
    available = cost(grant.available);
  let reason: string | null = null;
  if (
    [
      native.ledgerAmount,
      native.availableAmount,
      native.granted,
      native.applied,
      native.expired,
      native.voided,
      native.reinstated,
    ].some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    reason = "unsafe_native_amount";
  else if (native.reinstated > 0) reason = "invoice_void_requires_correction";
  else if (
    native.granted !== terms.amount ||
    native.ledgerAmount !==
      native.granted -
        native.applied -
        native.expired -
        native.voided +
        native.reinstated ||
    native.availableAmount > native.ledgerAmount
  )
    reason = "native_ledger_mismatch";
  else if (!invoicesVerified) reason = "invoice_provenance_unavailable";
  else if (native.applied > consumed) reason = "unexpected_native_consumption";
  else if (
    native.ledgerAmount < available + reserved + consumed - native.applied &&
    native.expired + native.voided === 0
  )
    reason = "insufficient_native_backing";
  else if (
    (native.expired > 0 || native.voided > 0) &&
    reserved + consumed - native.applied > 0
  )
    reason = "expired_pending_consumption";
  return {
    ledgerAmount: native.ledgerAmount,
    availableAmount: native.availableAmount,
    granted: native.granted,
    applied: native.applied,
    expired: native.expired,
    voided: native.voided,
    reinstated: native.reinstated,
    backing: reason ? "held" : "sufficient",
    reason,
    pendingFinalizationAmount: Math.max(0, consumed - native.applied),
    cashCollection: "none",
    invoicePaymentEvidence: "not_resolved",
  };
}
