import type { QueryCtx } from "../_generated/server.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type {
  UsageScope,
  PreparedUsageRecord,
} from "../../client/usage/records.js";
import { scopeKey } from "../usage/helpers.js";
export async function read(
  ctx: QueryCtx,
  args: { scope: UsageScope; eventId: Id<"usageEvents"> },
) {
  const event = await ctx.db.get("usageEvents", args.eventId);
  if (!event || event.scopeKey !== scopeKey(args.scope))
    throw new Error("Usage delivery scope unavailable");
  const outbox = await ctx.db
    .query("usageOutbox")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .unique();
  if (!outbox) throw new Error("Usage outbox unavailable");
  return {
    event,
    outbox,
    record: JSON.parse(event.recordJson) as PreparedUsageRecord,
  };
}
export function statusOf(outbox: Doc<"usageOutbox">) {
  return {
    validationErrors: [] as Array<{
      providerEventId: string;
      code: import("convex/values").Infer<
        typeof import("./fields.js").errorCode
      >;
      observedAt: number;
    }>,
    validationHistoryComplete: true,
    eventId: outbox.eventId,
    state: outbox.state,
    attempts: outbox.attempts,
    held: outbox.held ?? false,
    reason: outbox.reason,
    providerIdentifier: outbox.providerIdentifier,
    receipt: outbox.receipt,
  };
}
export function lockKeys(record: PreparedUsageRecord) {
  const realm = JSON.stringify([
    record.scope.stripeAccountId,
    record.scope.livemode,
  ]);
  return {
    realm,
    customer: JSON.stringify([
      realm,
      record.binding.stripeCustomerId,
      record.scope.meterId,
    ]),
  };
}

export async function currentStatus(ctx: QueryCtx, outbox: Doc<"usageOutbox">) {
  const errors = await ctx.db
    .query("usageDeliveryErrors")
    .withIndex("by_event", (q) => q.eq("eventId", outbox.eventId))
    .order("desc")
    .take(21);
  return {
    ...statusOf(outbox),
    validationErrors: errors
      .slice(0, 20)
      .map(({ providerEventId, code, observedAt }) => ({
        providerEventId,
        code,
        observedAt,
      })),
    validationHistoryComplete: errors.length <= 20,
  };
}
