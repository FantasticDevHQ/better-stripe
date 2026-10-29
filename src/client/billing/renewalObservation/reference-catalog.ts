import {
  object,
  array,
  need,
  get,
  equal,
  referenceId,
  type O,
} from "./common.js";
import type { createContext } from "./scheduled-context.js";
export function references(state: ReturnType<typeof createContext>) {
  const { originalSub, originalSchedule, schedule, sub, customer, context } =
    state;
  // BEGIN original 145-279
  const retainedSettings = [
    originalSub,
    get(originalSchedule, "default_settings"),
    object(array(originalSchedule.phases)[0]),
  ];
  const fullReferences = new Map<string, O[]>();
  const minimal = (v: O) =>
    Object.keys(v).every((k) =>
      ["id", "object", "deleted", "livemode", "customer_account"].includes(k),
    );
  const retain = (v: unknown, kind: string) => {
    if (v === null || v === undefined || typeof v === "string") return;
    const row = object(v);
    if (row.object === kind && !minimal(row)) {
      const key = kind + ":" + String(row.id);
      fullReferences.set(key, [...(fullReferences.get(key) ?? []), row]);
    }
  };
  for (const setting of retainedSettings) {
    retain(setting.default_payment_method, "payment_method");
    retain(setting.on_behalf_of, "account");
    if (setting.transfer_data)
      retain(get(setting, "transfer_data").destination, "account");
    if (setting.automatic_tax && get(setting, "automatic_tax").liability)
      retain(
        get(get(setting, "automatic_tax"), "liability").account,
        "account",
      );
    if (setting.invoice_settings) {
      const invoice = get(setting, "invoice_settings");
      if (invoice.issuer) retain(get(invoice, "issuer").account, "account");
      if (invoice.account_tax_ids)
        for (const tax of array(invoice.account_tax_ids)) {
          retain(tax, "tax_id");
          if (typeof tax !== "string" && object(tax).owner)
            retain(get(object(tax), "owner").account, "account");
        }
    }
  }
  // Fixed comparison roles: actual fresh data in live mode, immutable
  // historical material in baseline mode. Neither invents acquisition.
  // An arbitrary opaque field cannot act as a counterpart for a retained ref.
  const comparisonFullReferences = new Map<string, O[]>();
  const retainComparison = (v: unknown, kind: string) => {
    if (v === null || v === undefined || typeof v === "string") return;
    const row = object(v);
    if (row.object === kind && !minimal(row)) {
      const key = kind + ":" + String(row.id);
      comparisonFullReferences.set(key, [
        ...(comparisonFullReferences.get(key) ?? []),
        row,
      ]);
    }
  };
  for (const setting of [
    sub,
    get(schedule, "default_settings"),
    ...array(schedule.phases).map(object),
  ]) {
    retainComparison(setting.default_payment_method, "payment_method");
    retainComparison(setting.on_behalf_of, "account");
    if (setting.transfer_data)
      retainComparison(get(setting, "transfer_data").destination, "account");
    if (setting.automatic_tax && get(setting, "automatic_tax").liability)
      retainComparison(
        get(get(setting, "automatic_tax"), "liability").account,
        "account",
      );
    if (setting.invoice_settings) {
      const invoice = get(setting, "invoice_settings");
      if (invoice.issuer)
        retainComparison(get(invoice, "issuer").account, "account");
      if (invoice.account_tax_ids)
        for (const tax of array(invoice.account_tax_ids)) {
          retainComparison(tax, "tax_id");
          if (typeof tax !== "string" && object(tax).owner)
            retainComparison(get(object(tax), "owner").account, "account");
        }
    }
  }
  const ref = (v: unknown, prefix: string, kind: string): string => {
    const id = referenceId(
      v,
      prefix,
      kind,
      kind === "tax_id" ? undefined : context,
    );
    const retained = fullReferences.get(kind + ":" + id) ?? [];
    if (retained.length) {
      const fresh = comparisonFullReferences.get(kind + ":" + id) ?? [];
      need(
        fresh.length > 0 &&
          retained.every((old) => fresh.some((current) => equal(old, current))),
        "missing_fresh_full_" + kind + "_evidence",
        "unknown",
      );
    }
    if (typeof v !== "string") {
      const row = object(v);
      need(
        row.deleted === undefined || row.deleted === false,
        "unproven_deleted_reference",
        "unknown",
      );
      if (
        !minimal(row) &&
        ["customer", "payment_method", "account", "tax_id"].includes(kind)
      ) {
        const correlated =
          kind === "customer"
            ? [customer]
            : (fullReferences.get(kind + ":" + id) ?? []);
        need(
          correlated.length > 0 &&
            correlated.every((known) => equal(row, known)),
          "uncorrelated_full_" + kind + "_reference",
          "unknown",
        );
      }
      if (
        kind === "payment_method" &&
        row.customer !== null &&
        row.customer !== undefined
      )
        need(
          ref(row.customer, "cus", "customer") ===
            referenceId(originalSub.customer, "cus", "customer", context),
          "expanded_payment_method_customer_mismatch",
          "unknown",
        );
    }
    return id;
  };
  // END original 145-279
  return { ...state, ref };
}
