import type { QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
/** Never treat an unproven terminal projection as canceled billable quantity. */
export async function verifiedCancellation(
  ctx: QueryCtx,
  event: Doc<"usageEvents">,
  outbox: Doc<"usageOutbox"> | null,
) {
  if (outbox?.state !== "canceled") return "none" as const;
  if (!outbox.correctionKey) return "unverified" as const;
  const correction = await ctx.db
    .query("usageCorrections")
    .withIndex("by_key", (q) => q.eq("key", outbox.correctionKey!))
    .unique();
  const record = JSON.parse(event.recordJson);
  return correction?.state === "confirmed" &&
    correction.resolution !== "invoice_credit" &&
    correction.eventId === event._id &&
    correction.scopeKey === event.scopeKey &&
    correction.recordJson === event.recordJson &&
    correction.subscriptionJson === event.subscriptionJson &&
    correction.scaledQuantity === record.scaledQuantity &&
    correction.restoredQuantity === record.quantity
    ? ("confirmed" as const)
    : ("unverified" as const);
}
export const unresolvedCorrectionStates = [
  "requested",
  "provider_accepted",
  "held",
  "invoice_adjustment_required",
] as const;
