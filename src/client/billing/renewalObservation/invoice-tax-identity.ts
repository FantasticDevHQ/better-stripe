import { object, array, need, get, equal } from "./common.js";
import type { redemptions } from "./coupon-discount-joins.js";
export function taxes(state: ReturnType<typeof redemptions>) {
  const { expected, originalSub, originalSchedule, ref, originalPhase } = state;
  // BEGIN original 560-617
  const originalDefaults = get(originalSchedule, "default_settings");
  const invoiceObjects = [
    originalSub.invoice_settings,
    originalDefaults.invoice_settings,
    originalPhase.invoice_settings,
  ]
    .filter((v) => v !== null && v !== undefined)
    .map(object);
  const retainedTaxIds = invoiceObjects
    .flatMap((inv) =>
      inv.account_tax_ids === null || inv.account_tax_ids === undefined
        ? []
        : array(inv.account_tax_ids),
    )
    .filter((v) => typeof v !== "string")
    .map(object);
  const retainedPMs = [
    originalSub.default_payment_method,
    originalDefaults.default_payment_method,
    originalPhase.default_payment_method,
  ]
    .filter((v) => v !== null && v !== undefined && typeof v !== "string")
    .map(object);
  const invoiceTaxId = (value: unknown) => {
    const id = ref(value, "txi", "tax_id");
    if (typeof value !== "string") {
      const tax = object(value);
      need(
        tax.livemode === expected.livemode &&
          (tax.customer_account === undefined || tax.customer_account === null),
        "invoice_tax_mode_or_scope_mismatch",
      );
      const owner = get(tax, "owner"),
        issuer = get(get(originalSub, "invoice_settings"), "issuer");
      need(
        owner.type === issuer.type && owner.customer_account === null,
        "invoice_tax_owner_mismatch",
      );
      if (owner.type === "account")
        need(
          ref(owner.account, "acct", "account") ===
            ref(issuer.account, "acct", "account"),
          "invoice_tax_issuer_mismatch",
        );
      else
        need(
          owner.type === "self" &&
            (owner.account === undefined || owner.account === null),
          "invoice_tax_owner_unsupported",
          "unknown",
        );
      for (const retained of retainedTaxIds)
        if (retained.id === id)
          need(equal(tax, retained), "invoice_tax_full_read_drift");
    }
    return id;
  };
  // END original 560-617
  return { ...state, invoiceTaxId, retainedPMs };
}
