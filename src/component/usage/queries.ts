import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { query } from "../_generated/server.js";
import schema from "../schema.js";
import { eventDoc, scopeValidator, deliveryValidator } from "./schema.js";
import { scopeKey } from "./helpers.js";
import { validateUsagePageRequest } from "../../client/usage/boundaries.js";

const view = v.object({ event: eventDoc, delivery: deliveryValidator });
export const get = query({
  args: { scope: scopeValidator, eventId: v.id("usageEvents") },
  returns: v.union(view, v.null()),
  handler: async (ctx, args) => {
    const key = scopeKey(args.scope);
    const event = await ctx.db.get("usageEvents", args.eventId);
    if (!event || event.scopeKey !== key) return null;
    const outbox = await ctx.db
      .query("usageOutbox")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .unique();
    if (!outbox) throw new Error("Usage outbox invariant violated");
    return { event, delivery: outbox.state };
  },
});
export const read = query({
  args: {
    scope: scopeValidator,
    period: v.object({ start: v.number(), end: v.number() }),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(view),
  handler: async (ctx, args) => {
    const key = scopeKey(args.scope);
    const request = validateUsagePageRequest({
      period: args.period,
      limit: args.paginationOpts.numItems,
      cursor: args.paginationOpts.cursor,
    });
    const result = await paginator(ctx.db, schema)
      .query("usageEvents")
      .withIndex("by_scope_time", (q) =>
        q
          .eq("scopeKey", key)
          .gte("occurredAt", request.period.start)
          .lt("occurredAt", request.period.end),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: 200,
        maximumBytesRead: 1000000,
      });
    const page = await Promise.all(
      result.page.map(async (event) => {
        const outbox = await ctx.db
          .query("usageOutbox")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .unique();
        if (!outbox) throw new Error("Usage outbox invariant violated");
        return { event, delivery: outbox.state };
      }),
    );
    return { ...result, page };
  },
});
