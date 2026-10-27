import { z } from "zod";
import { taxRate } from "../renewalProjection/settingsSchema.js";
import { equal, unsupported } from "./shared.js";

/** Null/absent read hierarchies are not evidence of an explicit empty list. */
export function explicitTaxIds(value: unknown, level: string): string[] {
  const parsed = z.array(taxRate).max(20).safeParse(value);
  if (!parsed.success) unsupported(`unproven_${level}_tax_hierarchy`);
  return parsed.data.map((tax) => tax.id);
}

export type OriginalTaxLevels = { subscription: string[]; item: string[] };

export function preserveTaxLevels(
  original: OriginalTaxLevels,
  phaseTax: unknown,
  phaseItemTax: unknown,
) {
  const phase = explicitTaxIds(phaseTax, "phase_default");
  const item = explicitTaxIds(phaseItemTax, "phase_item");
  if (!equal(original.subscription, phase))
    unsupported("phase_default_tax_retention_mismatch");
  // An empty item array means no item override. Its subscription/phase default
  // applies instead. Equal current totals cannot authorize changing that level.
  if (original.item.length > 0 !== item.length > 0)
    unsupported("item_tax_override_level_changed");
  if (!equal(original.item, item)) unsupported("item_tax_retention_mismatch");
}
