import type { createContext } from "./scheduled-context.js";
import { references } from "./reference-catalog.js";
import { identities } from "./scheduled-identity.js";
import { redemptions } from "./coupon-discount-joins.js";
import { taxes } from "./invoice-tax-identity.js";
import { settingsStage } from "./settings-normalization.js";
import { phasesStage } from "./phase-price-normalization.js";
import { normalize } from "./scheduled-normalization.js";
import { templates } from "./schedule-templates.js";
import { baseline } from "./configured-baseline.js";
import { pending } from "./pending-and-stage.js";
import { active } from "./active-scheduled.js";
/** Private stages unchanged; fixed callers build their own checked context. */
export function runStages(c0: ReturnType<typeof createContext>) {
  const c1 = references(c0);
  const c2 = identities(c1);
  if (c2.kind === "result") return c2.result;
  const c3 = redemptions(c2.state);
  const c4 = taxes(c3);
  const c5 = settingsStage(c4);
  const c6 = phasesStage(c5);
  const c7 = normalize(c6);
  const c8 = templates(c7);
  if (c8.kind === "result") return c8.result;
  const c9 = baseline(c8.state);
  if (c9.kind === "result") return c9.result;
  const c10 = pending(c9.state);
  if (c10.kind === "result") return c10.result;
  return active(c10.state);
}
