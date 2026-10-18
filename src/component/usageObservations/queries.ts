import { verifiedCancellation } from "../usageCorrections/cancellation.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import schema from "../schema.js";
import { refFields } from "../usageDelivery/schema.js";
import { read } from "../usageDelivery/helpers.js";
import { historyDoc } from "./schema.js";
import { errorDoc } from "../usageDelivery/fields.js";
import { source } from "./helpers.js";
import { query } from "../_generated/server.js";
import { v } from "convex/values";
import { scopeValidator } from "../usage/schema.js";
import { scopeKey, subscriptionSnapshot } from "../usage/helpers.js";
import { validateUsagePageRequest } from "../../client/usage/boundaries.js";
import { summarizeUsageRecords } from "../../client/usage/summary.js";
import type { PreparedUsageRecord } from "../../client/usage/records.js";
export const summary = query({
  args: {
    scope: scopeValidator,
    period: v.object({ start: v.number(), end: v.number() }),
    maxRecords: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const key = scopeKey(args.scope);
    validateUsagePageRequest({ period: args.period, limit: 1, cursor: null });
    if (
      !Number.isInteger(args.maxRecords) ||
      args.maxRecords < 1 ||
      args.maxRecords > 500
    )
      throw new Error("Usage summary read budget must be 1–500");
    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_scope_time", (q) =>
        q
          .eq("scopeKey", key)
          .gte("occurredAt", args.period.start)
          .lt("occurredAt", args.period.end),
      )
      .take(args.maxRecords + 1);
    const views = await Promise.all(
      rows.slice(0, args.maxRecords).map(async (event) => {
        const [outbox, error] = await Promise.all([
          ctx.db
            .query("usageOutbox")
            .withIndex("by_event", (q) => q.eq("eventId", event._id))
            .unique(),
          ctx.db
            .query("usageDeliveryErrors")
            .withIndex("by_event", (q) => q.eq("eventId", event._id))
            .first(),
        ]);
        if (!outbox) throw new Error("Usage outbox invariant violated");
        const canceled = await verifiedCancellation(ctx, event, outbox);
        return {
          record: JSON.parse(event.recordJson) as PreparedUsageRecord,
          subscription: subscriptionSnapshot(event.subscriptionJson),
          delivery:
            canceled === "unverified" ? ("held" as const) : outbox.state,
          hasValidationError: canceled !== "confirmed" && error !== null,
        };
      }),
    );
    return JSON.stringify(
      summarizeUsageRecords(views, {
        period: args.period,
        observedAt: Math.floor(Date.now() / 1000),
        complete: rows.length <= args.maxRecords,
      }),
    );
  },
});

export const cached = query({
  args: { sourceJson: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const binding = await source(args.sourceJson);
    const row = await ctx.db
      .query("usageProviderObservations")
      .withIndex("by_key", (q) => q.eq("key", binding.key))
      .unique();
    return row &&
      row.scopeKey === binding.scopeKey &&
      row.sourceJson === binding.sourceJson
      ? row.observationJson
      : null;
  },
});

function validate(numItems: number, cursor: string | null) {
  validateUsagePageRequest({
    period: { start: 0, end: 1 },
    limit: numItems,
    cursor,
  });
}
const paginated = paginationResultValidator(historyDoc);
export const deliveryHistory = query({
  args: { ...refFields, paginationOpts: paginationOptsValidator },
  returns: v.object({ ...paginated.fields, legacyHistoryMissing: v.boolean() }),
  handler: async (ctx, args) => {
    const { outbox } = await read(ctx, args);
    validate(args.paginationOpts.numItems, args.paginationOpts.cursor);
    const [page, first] = await Promise.all([
      paginator(ctx.db, schema)
        .query("usageDeliveryHistory")
        .withIndex("by_event_sequence", (q) => q.eq("eventId", args.eventId))
        .order("asc")
        .paginate({
          ...args.paginationOpts,
          maximumRowsRead: 200,
          maximumBytesRead: 1000000,
        }),
      ctx.db
        .query("usageDeliveryHistory")
        .withIndex("by_event_identity", (q) =>
          q.eq("eventId", args.eventId).eq("identity", "started:1"),
        )
        .unique(),
    ]);
    return {
      ...page,
      legacyHistoryMissing: outbox.attempts > 0 && first === null,
    };
  },
});
export const validationHistory = query({
  args: { ...refFields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(errorDoc),
  handler: async (ctx, args) => {
    await read(ctx, args);
    validate(args.paginationOpts.numItems, args.paginationOpts.cursor);
    return paginator(ctx.db, schema)
      .query("usageDeliveryErrors")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
  },
});
