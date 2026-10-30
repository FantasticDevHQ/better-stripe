import { z } from "zod";
import { taxRate } from "./f08.mjs";
import { equal, unsupported } from "./f02.mjs";
/** Null/absent read hierarchies are not evidence of an explicit empty list. */
export function explicitTaxIds(value, level) {
  const parsed = z.array(taxRate).max(20).safeParse(value);
  if (!parsed.success) unsupported(`unproven_${level}_tax_hierarchy`);
  return parsed.data.map((tax) => tax.id);
}
export function preserveTaxLevels(original, phaseTax, phaseItemTax) {
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
