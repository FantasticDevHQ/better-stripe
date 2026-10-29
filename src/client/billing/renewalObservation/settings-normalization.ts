import { object, array, need, clone, get, equal, type O } from "./common.js";
import type { taxes } from "./invoice-tax-identity.js";
export function settingsStage(state: ReturnType<typeof taxes>) {
  const { ref, customerId, invoiceTaxId, retainedPMs } = state;
  // BEGIN original 618-669
  const settings = (v: O) => {
    const o = clone(v);
    for (const [field, prefix, kind] of [
      ["default_payment_method", "pm", "payment_method"],
      ["on_behalf_of", "acct", "account"],
    ] as const)
      if (o[field] !== null && o[field] !== undefined) {
        const value = o[field];
        if (field === "default_payment_method" && typeof value !== "string") {
          const pm = object(value);
          if (pm.customer !== null && pm.customer !== undefined)
            need(
              ref(pm.customer, "cus", "customer") === customerId,
              "expanded_payment_method_customer_mismatch",
            );
          for (const retained of retainedPMs)
            if (retained.id === pm.id)
              need(
                equal(pm, retained),
                "payment_method_full_read_drift",
                "unknown",
              );
        }
        o[field] = ref(value, prefix, kind);
      }
    if (o.transfer_data !== null && o.transfer_data !== undefined) {
      const t = get(o, "transfer_data");
      t.destination = ref(t.destination, "acct", "account");
      o.transfer_data = t;
    }
    for (const [outer, inner] of [
      ["automatic_tax", "liability"],
      ["invoice_settings", "issuer"],
    ])
      if (o[outer] !== null && o[outer] !== undefined) {
        const x = get(o, outer);
        if (x[inner] !== null && x[inner] !== undefined) {
          const q = get(x, inner);
          if (q.type === "account")
            q.account = ref(q.account, "acct", "account");
          x[inner] = q;
        }
        o[outer] = x;
      }
    if (o.invoice_settings !== null && o.invoice_settings !== undefined) {
      const inv = get(o, "invoice_settings");
      if (inv.account_tax_ids !== null && inv.account_tax_ids !== undefined)
        inv.account_tax_ids = array(inv.account_tax_ids).map(invoiceTaxId);
      o.invoice_settings = inv;
    }
    return o;
  };
  // END original 618-669
  return { ...state, settings };
}
