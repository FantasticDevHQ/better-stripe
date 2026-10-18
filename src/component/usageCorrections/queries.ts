import { scopeValidator } from "../usage/schema.js";
import { scopeKey } from "../usage/helpers.js";
import { validateUsagePageRequest } from "../../client/usage/boundaries.js";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import { refFields } from "../usageDelivery/schema.js";
import { read } from "../usageDelivery/helpers.js";
import { canonicalFingerprint } from "../operationEvidence/canonical.js";
import { historyDoc, operationDoc } from "./schema.js";
export const readHistory = query({
  args: { ...refFields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(historyDoc),
  handler: async (ctx, args) => {
    await read(ctx, args);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid correction history page");
    return paginator(ctx.db, schema)
      .query("usageCorrectionHistory")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
  },
});

export const get = query({
  args: { ...refFields, correctionId: v.string() },
  returns: v.union(operationDoc, v.null()),
  handler: async (ctx, args) => {
    await read(ctx, args);
    if (!args.correctionId || args.correctionId.length > 100)
      throw new Error("Invalid correction identity");
    const key = await canonicalFingerprint([args.scope, args.correctionId]);
    const row = await ctx.db
      .query("usageCorrections")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.eventId === args.eventId ? row : null;
  },
});

export const periodHistory = query({
  args: {
    scope: scopeValidator,
    period: v.object({ start: v.number(), end: v.number() }),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    ...paginationResultValidator(historyDoc).fields,
    legacyHistoryMissing: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateUsagePageRequest({
      period: args.period,
      limit: args.paginationOpts.numItems,
      cursor: args.paginationOpts.cursor,
    });
    const key = scopeKey(args.scope);
    const legacy = await ctx.db
      .query("usageCorrectionHistory")
      .withIndex("by_scope_occurrence", (q) =>
        q.eq("scopeKey", key).eq("occurredAt", undefined),
      )
      .first();
    const result = await paginator(ctx.db, schema)
      .query("usageCorrectionHistory")
      .withIndex("by_scope_occurrence", (q) =>
        q
          .eq("scopeKey", key)
          .gte("occurredAt", args.period.start)
          .lt("occurredAt", args.period.end),
      )
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
    return { ...result, legacyHistoryMissing: legacy !== null };
  },
});
