import { z } from "zod";
import { settingsInput } from "../renewalProjection/settingsSchema.js";
import { projectRenewalPhaseSettings } from "../renewalProjection/settings.js";
import { object, equal, referenceId, unsupported } from "./shared.js";
import type { qualifyOriginalSettings } from "./sourceSettings.js";

export const defaultsSchema = settingsInput.shape.settings
  .omit({
    metadata: true,
    default_tax_rates: true,
  })
  .extend({
    billing_cycle_anchor: z.enum(["automatic", "phase_start"]),
    invoice_settings:
      settingsInput.shape.settings.shape.invoice_settings.unwrap(),
  })
  .strict();
export type Defaults = z.infer<typeof defaultsSchema>;

const issuerId = (value: unknown) => {
  const issuer = object(value);
  return issuer.type === "self"
    ? "self"
    : referenceId(issuer.account, "acct", "account");
};
const refOrNull = (value: unknown, prefix: string, kind: string) =>
  value == null ? null : referenceId(value, prefix, kind);

export function contextFor(
  phase: Record<string, unknown>,
  defaults: Defaults,
  subscription: Record<string, unknown>,
  customerId: string,
  customerAccountId: string,
  livemode: boolean,
  originalSettings: ReturnType<typeof qualifyOriginalSettings>,
) {
  const phaseInvoice =
    phase.invoice_settings == null ? null : object(phase.invoice_settings);
  const sourceInvoice = originalSettings.invoice;
  const sourceTax = originalSettings.automaticTax;
  const phaseTax =
    phase.automatic_tax === undefined ? undefined : object(phase.automatic_tax);
  const effectiveCollectionMethod =
    phase.collection_method ??
    defaults.collection_method ??
    subscription.collection_method;
  const effectiveAutomaticTax =
    phaseTax?.enabled ?? defaults.automatic_tax?.enabled ?? sourceTax.enabled;
  const effectiveInvoiceIssuer =
    phaseInvoice?.issuer ??
    defaults.invoice_settings.issuer ??
    sourceInvoice.issuer;
  const context = settingsInput.shape.context.parse({
    customerId,
    customerAccountId,
    livemode,
    effectiveCollectionMethod,
    effectiveAutomaticTax,
    effectiveInvoiceIssuer,
  });
  if (
    context.effectiveCollectionMethod !== subscription.collection_method ||
    context.effectiveAutomaticTax !== sourceTax.enabled ||
    issuerId(context.effectiveInvoiceIssuer) !== issuerId(sourceInvoice.issuer)
  )
    unsupported("effective_phase_context_mismatch");
  const liability =
    phaseTax?.liability ?? defaults.automatic_tax?.liability ?? null;
  const liabilityId = (value: unknown) =>
    value == null ? null : issuerId(value);
  if (liabilityId(liability) !== liabilityId(sourceTax.liability))
    unsupported("unproven_tax_liability_retention");
  const defaultProjection = projectRenewalPhaseSettings({
    context,
    settings: {
      application_fee_percent: defaults.application_fee_percent,
      billing_thresholds: defaults.billing_thresholds,
      collection_method: defaults.collection_method,
      default_payment_method: defaults.default_payment_method,
      on_behalf_of: defaults.on_behalf_of,
      transfer_data: defaults.transfer_data,
      ...(defaults.automatic_tax === undefined
        ? {}
        : { automatic_tax: defaults.automatic_tax }),
      default_tax_rates: null,
      invoice_settings: defaults.invoice_settings,
      description: defaults.description,
      metadata: null,
    },
  });
  if (defaultProjection.status !== "projected")
    unsupported(`unsupported_defaults_${defaultProjection.reason}`);
  for (const [field, prefix, kind] of [
    ["default_payment_method", "pm", "payment_method"],
    ["on_behalf_of", "acct", "account"],
  ] as const) {
    const effective = phase[field] ?? defaults[field];
    if (
      refOrNull(effective, prefix, kind) !==
      refOrNull(subscription[field], prefix, kind)
    )
      unsupported(`unproven_${field}_retention`);
  }
  const effectiveTransfer = phase.transfer_data ?? defaults.transfer_data;
  const normalizeTransfer = (value: unknown) => {
    if (value == null) return null;
    const transfer = object(value);
    return {
      destination: referenceId(transfer.destination, "acct", "account"),
      amount_percent: transfer.amount_percent,
    };
  };
  if (
    !equal(
      normalizeTransfer(effectiveTransfer),
      normalizeTransfer(subscription.transfer_data),
    )
  )
    unsupported("unproven_transfer_data_retention");
  if ((phase.description ?? defaults.description) !== subscription.description)
    unsupported("unproven_description_retention");
  const due =
    phaseInvoice?.days_until_due ?? defaults.invoice_settings.days_until_due;
  if (due !== subscription.days_until_due)
    unsupported("unproven_invoice_due_retention");
  for (const field of ["custom_fields", "description", "footer"] as const) {
    const effective = phaseInvoice?.[field] ?? defaults.invoice_settings[field];
    if (!equal(effective, sourceInvoice[field]))
      unsupported(`unproven_invoice_${field}_retention`);
  }
  const effectiveTaxIds =
    phaseInvoice?.account_tax_ids ?? defaults.invoice_settings.account_tax_ids;
  const taxIds = (value: unknown) =>
    value == null
      ? null
      : z
          .array(z.unknown())
          .parse(value)
          .map((tax) => referenceId(tax, "txi", "tax_id"));
  if (!equal(taxIds(effectiveTaxIds), taxIds(sourceInvoice.account_tax_ids)))
    unsupported("unproven_invoice_tax_id_retention");
  return context;
}
