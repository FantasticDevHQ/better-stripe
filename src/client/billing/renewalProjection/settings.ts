import type Stripe from "stripe";
import type { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { settingsInput, type reference } from "./settingsSchema.js";

type Settings = Pick<
  Stripe.SubscriptionScheduleUpdateParams.Phase,
  | "collection_method"
  | "default_payment_method"
  | "on_behalf_of"
  | "transfer_data"
  | "automatic_tax"
  | "default_tax_rates"
  | "invoice_settings"
  | "description"
  | "metadata"
>;
type Result =
  | { status: "unsupported"; reason: string }
  | {
      status: "projected";
      settings: Settings;
      requiresProviderQualification: true;
    };
type Reference = z.infer<ReturnType<typeof reference>>;
const identity = (ref: Reference) => (typeof ref === "string" ? ref : ref.id);

/**
 * Map only the named fields of a provider phase. The aggregate assembler must
 * correlate context with its full acknowledged schedule and unchanged defaults.
 * A projection is neither a complete phase nor evidence of provider retention.
 */
export function projectRenewalPhaseSettings(input: unknown): Result {
  let args: z.infer<typeof settingsInput>;
  try {
    args = settingsInput.parse(renewalSnapshot(input));
  } catch {
    return { status: "unsupported", reason: "unsupported_phase_settings" };
  }
  const { settings: source, context } = args;
  const failure = (reason: string): Result => ({
    status: "unsupported",
    reason,
  });
  const referenceMatches = (ref: Reference | null | undefined) => {
    if (ref == null || typeof ref === "string") return true;
    const customer = ref.customer;
    if (
      typeof customer === "object" &&
      customer !== null &&
      ((customer.livemode !== undefined &&
        customer.livemode !== context.livemode) ||
        (customer.customer_account !== undefined &&
          customer.customer_account !== context.customerAccountId))
    )
      return false;
    return (
      (ref.livemode === undefined || ref.livemode === context.livemode) &&
      (ref.customer_account == null ||
        ref.customer_account === context.customerAccountId) &&
      (customer == null || identity(customer) === context.customerId)
    );
  };
  const references = [
    source.default_payment_method,
    source.on_behalf_of,
    source.transfer_data?.destination,
    ...(source.invoice_settings?.account_tax_ids ?? []),
    ...(source.default_tax_rates ?? []),
    source.automatic_tax?.liability?.account,
    source.invoice_settings?.issuer?.account,
  ];
  if (!references.every(referenceMatches))
    return failure("foreign_setting_reference");
  const issuerIdentity = (issuer: typeof context.effectiveInvoiceIssuer) =>
    issuer.type === "self" ? "self" : identity(issuer.account);
  if (
    source.invoice_settings?.issuer != null &&
    issuerIdentity(source.invoice_settings.issuer) !==
      issuerIdentity(context.effectiveInvoiceIssuer)
  )
    return failure("invoice_issuer_mismatch");
  for (const taxId of source.invoice_settings?.account_tax_ids ?? []) {
    if (typeof taxId === "string") continue;
    const owner = taxId.owner;
    if (
      issuerIdentity(owner) !==
        issuerIdentity(context.effectiveInvoiceIssuer) ||
      (owner.type === "account" && !referenceMatches(owner.account))
    )
      return failure("foreign_invoice_tax_owner");
  }
  if (
    source.collection_method != null &&
    source.collection_method !== context.effectiveCollectionMethod
  )
    return failure("collection_method_mismatch");
  if (
    source.automatic_tax !== undefined &&
    source.automatic_tax.enabled !== context.effectiveAutomaticTax
  )
    return failure("automatic_tax_mismatch");
  if (context.effectiveAutomaticTax && source.default_tax_rates?.length)
    return failure("automatic_and_manual_tax");
  const out: Settings = {};
  if (source.collection_method !== null)
    out.collection_method = source.collection_method;
  if (source.default_payment_method !== null)
    out.default_payment_method = identity(source.default_payment_method);
  if (source.on_behalf_of !== null)
    out.on_behalf_of = identity(source.on_behalf_of);
  if (source.transfer_data !== null) {
    out.transfer_data = {
      destination: identity(source.transfer_data.destination),
    };
    if (source.transfer_data.amount_percent !== null)
      out.transfer_data.amount_percent = source.transfer_data.amount_percent;
  }
  const mapIssuer = (
    issuer: NonNullable<typeof source.automatic_tax>["liability"],
  ) =>
    issuer?.type === "account"
      ? { type: "account" as const, account: identity(issuer.account) }
      : { type: "self" as const };
  if (source.automatic_tax !== undefined) {
    out.automatic_tax = { enabled: source.automatic_tax.enabled };
    if (source.automatic_tax.liability != null)
      out.automatic_tax.liability = mapIssuer(source.automatic_tax.liability);
  }
  if (source.default_tax_rates != null)
    out.default_tax_rates = source.default_tax_rates.length
      ? source.default_tax_rates.map(identity)
      : "";
  const invoice = source.invoice_settings;
  if (invoice !== null) {
    const mapped: NonNullable<Settings["invoice_settings"]> = {};
    if (invoice.account_tax_ids !== null)
      mapped.account_tax_ids = invoice.account_tax_ids.length
        ? invoice.account_tax_ids.map(identity)
        : "";
    if (invoice.custom_fields !== null)
      mapped.custom_fields = invoice.custom_fields.length
        ? invoice.custom_fields.map(({ name, value }) => ({ name, value }))
        : "";
    if (invoice.issuer !== null) mapped.issuer = mapIssuer(invoice.issuer);
    if (invoice.days_until_due !== null) {
      if (context.effectiveCollectionMethod !== "send_invoice")
        return failure("incompatible_invoice_due_days");
      mapped.days_until_due = invoice.days_until_due;
    }
    if (invoice.description !== null) mapped.description = invoice.description;
    if (invoice.footer !== null) mapped.footer = invoice.footer;
    if (Object.keys(mapped).length) out.invoice_settings = mapped;
  }
  if (source.description !== null) out.description = source.description;
  if (source.metadata !== null && Object.keys(source.metadata).length)
    out.metadata = source.metadata;
  return {
    status: "projected",
    settings: out,
    requiresProviderQualification: true,
  };
}
