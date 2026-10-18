import type { MutationCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import type { Infer } from "convex/values";
import type { historyPhase } from "./schema.js";
export async function appendDeliveryHistory(
  ctx: MutationCtx,
  eventId: Id<"usageEvents">,
  phase: Infer<typeof historyPhase>,
  attempt: number,
  identity: string,
  created?: number,
) {
  const prior = await ctx.db
    .query("usageDeliveryHistory")
    .withIndex("by_event_identity", (q) =>
      q.eq("eventId", eventId).eq("identity", identity),
    )
    .unique();
  if (prior) return;
  const outbox = await ctx.db
    .query("usageOutbox")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();
  if (!outbox) throw new Error("Usage history event unavailable");
  const sequence = (outbox.historySequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence))
    throw new Error("Usage history sequence exhausted");
  await ctx.db.insert("usageDeliveryHistory", {
    eventId,
    scopeKey: outbox.scopeKey,
    sequence,
    attempt,
    phase,
    identity,
    recordedAt: Math.floor(Date.now() / 1000),
    ...(created !== undefined ? { created } : {}),
  });
  await ctx.db.patch("usageOutbox", outbox._id, { historySequence: sequence });
}
