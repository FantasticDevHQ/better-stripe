import { z } from "zod";
import { renewalSnapshot } from "./f10.mjs";
import { taxRate } from "./f08.mjs";
const inputSchema = z
  .object({
    effectiveAutomaticTax: z.boolean(),
    livemode: z.boolean(),
    settings: z
      .object({
        billing_thresholds: z.null(),
        tax_rates: z.array(taxRate).max(20).nullable().optional(),
        metadata: z
          .record(z.string().max(40), z.string().min(1).max(500))
          .nullable(),
      })
      .strict(),
  })
  .strict();
/** Field projection only. The assembler must derive effective tax from defaults. */
export function projectRenewalItemSettings(input) {
  let args;
  try {
    args = inputSchema.parse(renewalSnapshot(input));
  } catch {
    return { status: "unsupported", reason: "unsupported_item_settings" };
  }
  const { settings: source } = args;
  if (
    (args.effectiveAutomaticTax && source.tax_rates?.length) ||
    source.tax_rates?.some((tax) => tax.livemode !== args.livemode)
  )
    return { status: "unsupported", reason: "incompatible_item_tax" };
  const settings = {};
  if (source.tax_rates != null)
    settings.tax_rates = source.tax_rates.length
      ? source.tax_rates.map((tax) => tax.id)
      : "";
  if (source.metadata !== null && Object.keys(source.metadata).length)
    settings.metadata = source.metadata;
  return { status: "projected", settings, requiresProviderQualification: true };
}
