import type Stripe from "stripe";
import { z } from "zod";
import { renewalSnapshot } from "../renewalReplacementSnapshot.js";
import { taxRate } from "./settingsSchema.js";

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
type Settings = Pick<
  Stripe.SubscriptionScheduleUpdateParams.Phase.Item,
  "tax_rates" | "metadata"
>;
type Result =
  | { status: "unsupported"; reason: string }
  | {
      status: "projected";
      settings: Settings;
      requiresProviderQualification: true;
    };

/** Field projection only. The assembler must derive effective tax from defaults. */
export function projectRenewalItemSettings(input: unknown): Result {
  let args: z.infer<typeof inputSchema>;
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
  const settings: Settings = {};
  if (source.tax_rates != null)
    settings.tax_rates = source.tax_rates.length
      ? source.tax_rates.map((tax) => tax.id)
      : "";
  if (source.metadata !== null && Object.keys(source.metadata).length)
    settings.metadata = source.metadata;
  return { status: "projected", settings, requiresProviderQualification: true };
}
