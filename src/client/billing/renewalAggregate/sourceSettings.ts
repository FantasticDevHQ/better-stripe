import { settingsInput } from "../renewalProjection/settingsSchema.js";
import { projectRenewalPhaseSettings } from "../renewalProjection/settings.js";
import { projectRenewalItemSettings } from "../renewalProjection/itemSettings.js";
import { explicitTaxIds } from "./taxRetention.js";
import { unsupported } from "./shared.js";

const invoiceSchema = settingsInput.shape.settings.shape.invoice_settings
  .unwrap()
  .omit({ days_until_due: true })
  .extend({
    issuer: settingsInput.shape.context.shape.effectiveInvoiceIssuer,
  })
  .strict();

/**
 * Classify actual original subscription/item fields before any attachment.
 * The field projections below are validation views, not fabricated phase reads
 * or provider acknowledgement. Their output is never dispatched or adopted.
 */
export function qualifyOriginalSettings(
  subscription: Record<string, unknown>,
  item: Record<string, unknown>,
  customer: { id: string; customer_account: string; livemode: boolean },
) {
  const invoice = invoiceSchema.safeParse(subscription.invoice_settings);
  if (!invoice.success) unsupported("unsupported_original_invoice_settings");
  const automaticTax = settingsInput.shape.settings.shape.automatic_tax
    .unwrap()
    .safeParse(subscription.automatic_tax);
  if (!automaticTax.success) unsupported("unsupported_original_automatic_tax");
  const parsedContext = settingsInput.shape.context.safeParse({
    customerId: customer.id,
    customerAccountId: customer.customer_account,
    livemode: customer.livemode,
    effectiveCollectionMethod: subscription.collection_method,
    effectiveAutomaticTax: automaticTax.data.enabled,
    effectiveInvoiceIssuer: invoice.data.issuer,
  });
  if (!parsedContext.success)
    unsupported("unsupported_original_billing_context");
  const context = parsedContext.data;
  const taxLevels = {
    subscription: explicitTaxIds(
      subscription.default_tax_rates,
      "original_subscription",
    ),
    item: explicitTaxIds(item.tax_rates, "original_item"),
  };
  const projection = projectRenewalPhaseSettings({
    context,
    settings: {
      application_fee_percent: subscription.application_fee_percent,
      billing_thresholds: subscription.billing_thresholds,
      collection_method: subscription.collection_method,
      default_payment_method: subscription.default_payment_method,
      on_behalf_of: subscription.on_behalf_of,
      transfer_data: subscription.transfer_data,
      automatic_tax: automaticTax.data,
      default_tax_rates: subscription.default_tax_rates,
      // days_until_due is a top-level Subscription field in Stripe 23.
      invoice_settings: {
        ...invoice.data,
        days_until_due: subscription.days_until_due,
      },
      description: subscription.description,
      metadata: null,
    },
  });
  if (projection.status !== "projected")
    unsupported(`unsupported_original_settings_${projection.reason}`);
  const itemProjection = projectRenewalItemSettings({
    effectiveAutomaticTax: context.effectiveAutomaticTax,
    livemode: context.livemode,
    settings: {
      billing_thresholds: item.billing_thresholds,
      tax_rates: item.tax_rates,
      metadata: item.metadata,
    },
  });
  if (itemProjection.status !== "projected")
    unsupported(`unsupported_original_${itemProjection.reason}`);
  return {
    context,
    invoice: invoice.data,
    automaticTax: automaticTax.data,
    taxLevels,
  };
}
